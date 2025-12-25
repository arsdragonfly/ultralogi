#[macro_use]
extern crate napi_derive;

use arrow::ipc::writer::StreamWriter;
use duckdb::Connection;
use napi::bindgen_prelude::Buffer;
use once_cell::sync::Lazy;
use std::sync::Mutex;

// Global DuckDB connection - thread-safe via Mutex
static DB: Lazy<Mutex<Connection>> = Lazy::new(|| {
    let conn = Connection::open_in_memory().expect("Failed to create DuckDB connection");

    // Configure for low-latency single-threaded operation
    conn.execute_batch("SET threads = 1;").ok();

    Mutex::new(conn)
});

/// Hello world function - test the napi binding
#[napi]
pub fn hello(name: String) -> String {
    format!("Hello, {}! Ultralogi engine ready.", name)
}

/// Execute a SQL statement (INSERT, UPDATE, DELETE, CREATE, etc.)
/// Returns the number of rows affected, or throws on error
#[napi]
pub fn execute(sql: String) -> napi::Result<i32> {
    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let rows = conn
        .execute(&sql, [])
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    Ok(rows as i32)
}

/// Query and return results as Arrow IPC stream buffer (zero-copy to JS)
/// Use apache-arrow in JS to read: `tableFromIPC(buffer)`
#[napi]
pub fn query(sql: String) -> napi::Result<Buffer> {
    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let arrow_result = stmt
        .query_arrow([])
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    // Collect batches first to get schema
    let batches: Vec<_> = arrow_result.collect();

    if batches.is_empty() {
        // Return empty IPC stream with empty schema
        return Ok(Buffer::from(Vec::new()));
    }

    let schema = batches[0].schema();
    let mut buf: Vec<u8> = Vec::new();

    {
        let mut writer = StreamWriter::try_new(&mut buf, &schema)
            .map_err(|e: arrow::error::ArrowError| napi::Error::from_reason(e.to_string()))?;

        for batch in &batches {
            writer
                .write(batch)
                .map_err(|e: arrow::error::ArrowError| napi::Error::from_reason(e.to_string()))?;
        }

        writer
            .finish()
            .map_err(|e: arrow::error::ArrowError| napi::Error::from_reason(e.to_string()))?;
    }

    Ok(Buffer::from(buf))
}

/// Benchmark each step of the tile query pipeline
/// Returns JSON with timing breakdown in microseconds
#[napi]
pub fn benchmark_tile_query(tile_spacing: f64, color_scale: f64) -> napi::Result<String> {
    use arrow::array::{Float32Array, Int32Array};
    use std::time::Instant;

    let tile_spacing = tile_spacing as f32;
    let color_scale = color_scale as f32;

    let total_start = Instant::now();

    // Step 1: Acquire lock
    let lock_start = Instant::now();
    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let lock_us = lock_start.elapsed().as_nanos() as f64 / 1000.0;

    // Step 2: Prepare statement
    let prepare_start = Instant::now();
    let mut stmt = conn
        .prepare("SELECT x, y, tile_type, elevation FROM tiles ORDER BY y, x")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let prepare_us = prepare_start.elapsed().as_nanos() as f64 / 1000.0;

    // Step 3: Execute query and get Arrow batches
    let query_start = Instant::now();
    let arrow_result = stmt
        .query_arrow([])
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let query_us = query_start.elapsed().as_nanos() as f64 / 1000.0;

    // Step 4: Collect batches
    let collect_start = Instant::now();
    let batches: Vec<_> = arrow_result.collect();
    let collect_us = collect_start.elapsed().as_nanos() as f64 / 1000.0;

    if batches.is_empty() {
        return Ok(r#"{"error": "no data"}"#.to_string());
    }

    // Step 5: Count rows
    let count_start = Instant::now();
    let total_rows: usize = batches.iter().map(|b| b.num_rows()).sum();
    let count_us = count_start.elapsed().as_nanos() as f64 / 1000.0;

    // Step 6: Allocate output vectors
    let alloc_start = Instant::now();
    let mut positions: Vec<f32> = Vec::with_capacity(total_rows * 4);
    let mut colors: Vec<f32> = Vec::with_capacity(total_rows * 4);
    let alloc_us = alloc_start.elapsed().as_nanos() as f64 / 1000.0;

    // Tile type to color mapping
    fn tile_color(tile_type: i32, color_scale: f32) -> (f32, f32, f32) {
        match tile_type {
            0 => (0.2 * color_scale, 0.5 * color_scale, 0.8 * color_scale),
            1 => (0.3 * color_scale, 0.7 * color_scale, 0.3 * color_scale),
            2 => (0.6 * color_scale, 0.6 * color_scale, 0.5 * color_scale),
            3 => (0.9 * color_scale, 0.9 * color_scale, 0.95 * color_scale),
            4 => (0.8 * color_scale, 0.7 * color_scale, 0.4 * color_scale),
            5 => (0.1 * color_scale, 0.4 * color_scale, 0.1 * color_scale),
            _ => (0.5 * color_scale, 0.5 * color_scale, 0.5 * color_scale),
        }
    }

    // Step 7: Transform data (positions + colors)
    let transform_start = Instant::now();
    for batch in &batches {
        let x_col = batch.column(0).as_any().downcast_ref::<Int32Array>().unwrap();
        let y_col = batch.column(1).as_any().downcast_ref::<Int32Array>().unwrap();
        let type_col = batch.column(2).as_any().downcast_ref::<Int32Array>().unwrap();
        let elev_col = batch.column(3).as_any().downcast_ref::<Float32Array>().unwrap();

        for i in 0..batch.num_rows() {
            let x = x_col.value(i) as f32 * tile_spacing;
            let y = y_col.value(i) as f32 * tile_spacing;
            let z = elev_col.value(i);
            let tile_type = type_col.value(i);

            positions.push(x);
            positions.push(y);
            positions.push(z);
            positions.push(1.0);

            let (r, g, b) = tile_color(tile_type, color_scale);
            colors.push(r);
            colors.push(g);
            colors.push(b);
            colors.push(1.0);
        }
    }
    let transform_us = transform_start.elapsed().as_nanos() as f64 / 1000.0;

    // Step 8: Pack output buffer
    let pack_start = Instant::now();
    let count = total_rows as u32;
    let mut output = Vec::with_capacity(4 + positions.len() * 4 + colors.len() * 4);
    output.extend_from_slice(&count.to_le_bytes());
    for p in &positions {
        output.extend_from_slice(&p.to_le_bytes());
    }
    for c in &colors {
        output.extend_from_slice(&c.to_le_bytes());
    }
    let pack_us = pack_start.elapsed().as_nanos() as f64 / 1000.0;

    // Step 9: Create napi Buffer
    let buffer_start = Instant::now();
    let _buffer = Buffer::from(output);
    let buffer_us = buffer_start.elapsed().as_nanos() as f64 / 1000.0;

    let total_us = total_start.elapsed().as_nanos() as f64 / 1000.0;

    // Return JSON with breakdown
    Ok(format!(
        r#"{{"total_us": {:.2}, "rows": {}, "breakdown": {{"lock_us": {:.2}, "prepare_us": {:.2}, "query_us": {:.2}, "collect_us": {:.2}, "count_us": {:.2}, "alloc_us": {:.2}, "transform_us": {:.2}, "pack_us": {:.2}, "buffer_us": {:.2}}}}}"#,
        total_us, total_rows, lock_us, prepare_us, query_us, collect_us, count_us, alloc_us, transform_us, pack_us, buffer_us
    ))
}

/// Query tiles and return GPU-ready positions (Float32Array) + colors (Float32Array)
/// Returns raw bytes: [positions_f32...][colors_f32...]
/// This computes positions/colors in DuckDB - no JS loops needed!
#[napi]
pub fn query_tiles_gpu_ready(tile_spacing: f64, color_scale: f64) -> napi::Result<Buffer> {
    use arrow::array::{Float32Array, Int32Array};

    let tile_spacing = tile_spacing as f32;
    let color_scale = color_scale as f32;

    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    // Query raw tile data
    let mut stmt = conn
        .prepare("SELECT x, y, tile_type, elevation FROM tiles ORDER BY y, x")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let batches: Vec<_> = stmt
        .query_arrow([])
        .map_err(|e| napi::Error::from_reason(e.to_string()))?
        .collect();

    if batches.is_empty() {
        return Ok(Buffer::from(Vec::new()));
    }

    // Count total rows
    let total_rows: usize = batches.iter().map(|b| b.num_rows()).sum();

    // Pre-allocate output arrays:
    // positions: vec4 per vertex (x,y,z,w) = 4 floats per tile
    // colors: vec4 per vertex (r,g,b,a) = 4 floats per tile
    let mut positions: Vec<f32> = Vec::with_capacity(total_rows * 4);
    let mut colors: Vec<f32> = Vec::with_capacity(total_rows * 4);

    // Tile type to color mapping (computed in Rust, not JS!)
    fn tile_color(tile_type: i32, color_scale: f32) -> (f32, f32, f32) {
        match tile_type {
            0 => (0.2 * color_scale, 0.5 * color_scale, 0.8 * color_scale), // water - blue
            1 => (0.3 * color_scale, 0.7 * color_scale, 0.3 * color_scale), // grass - green
            2 => (0.6 * color_scale, 0.6 * color_scale, 0.5 * color_scale), // rock - gray
            3 => (0.9 * color_scale, 0.9 * color_scale, 0.95 * color_scale), // snow - white
            4 => (0.8 * color_scale, 0.7 * color_scale, 0.4 * color_scale), // sand - yellow
            5 => (0.1 * color_scale, 0.4 * color_scale, 0.1 * color_scale), // forest - dark green
            _ => (0.5 * color_scale, 0.5 * color_scale, 0.5 * color_scale), // unknown - gray
        }
    }

    for batch in &batches {
        let x_col = batch.column(0).as_any().downcast_ref::<Int32Array>().unwrap();
        let y_col = batch.column(1).as_any().downcast_ref::<Int32Array>().unwrap();
        let type_col = batch.column(2).as_any().downcast_ref::<Int32Array>().unwrap();
        let elev_col = batch.column(3).as_any().downcast_ref::<Float32Array>().unwrap();

        for i in 0..batch.num_rows() {
            let x = x_col.value(i) as f32 * tile_spacing;
            let y = y_col.value(i) as f32 * tile_spacing;
            let z = elev_col.value(i);
            let tile_type = type_col.value(i);

            // Position vec4 (x, y, z, w=1)
            positions.push(x);
            positions.push(y);
            positions.push(z);
            positions.push(1.0);

            // Color vec4 (r, g, b, a=1)
            let (r, g, b) = tile_color(tile_type, color_scale);
            colors.push(r);
            colors.push(g);
            colors.push(b);
            colors.push(1.0);
        }
    }

    // Pack into single buffer: [count:u32][positions...][colors...]
    let count = total_rows as u32;
    let mut output = Vec::with_capacity(4 + positions.len() * 4 + colors.len() * 4);

    // Write count as first 4 bytes
    output.extend_from_slice(&count.to_le_bytes());

    // Write positions as f32
    for p in &positions {
        output.extend_from_slice(&p.to_le_bytes());
    }

    // Write colors as f32
    for c in &colors {
        output.extend_from_slice(&c.to_le_bytes());
    }

    Ok(Buffer::from(output))
}
