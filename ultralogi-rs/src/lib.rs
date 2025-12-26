#[macro_use]
extern crate napi_derive;

use arrow::ipc::writer::StreamWriter;
use duckdb::Connection;
use napi::bindgen_prelude::Buffer;
use once_cell::sync::Lazy;
use polars::prelude::*;
use std::collections::HashMap;
use std::sync::Mutex;

// Global DuckDB connection - thread-safe via Mutex
static DB: Lazy<Mutex<Connection>> = Lazy::new(|| {
    let conn = Connection::open_in_memory().expect("Failed to create DuckDB connection");

    // DuckDB configuration for optimal Arrow export performance:
    // Based on benchmarks and upstream DuckDB source code analysis
    //
    // KEY FINDINGS:
    // - 2 threads is optimal (8 threads has contention overhead)
    // - preserve_insertion_order=false gives ~10% improvement
    // - Row iterator ≈ Arrow speed, so bottleneck is data reading, not Arrow conversion
    // - force_compression=uncompressed disables bitpacking/RLE - faster reads!
    conn.execute_batch(
        "-- Optimal thread count (2 is best, 8 has contention)
         SET threads TO 2;
         -- Don't preserve order - allows more parallelism
         SET preserve_insertion_order = false;
         -- Disable progress bar (small overhead)
         SET enable_progress_bar = false;
         -- Arrow output settings (from DuckDB settings.hpp)
         SET produce_arrow_string_view = false;
         SET arrow_large_buffer_size = false;
         SET arrow_output_list_view = false;
         -- Memory limit
         SET memory_limit = '4GB';
         -- CRITICAL: Force uncompressed storage for maximum read bandwidth!
         -- Disables bitpacking, RLE, dictionary encoding - no decompression on read
         SET force_compression = 'uncompressed';"
    ).ok();

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

/// Explain a query and return the query plan as a string
#[napi]
pub fn explain_query(sql: String) -> napi::Result<String> {
    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let explain_sql = format!("EXPLAIN ANALYZE {}", sql);
    let mut stmt = conn
        .prepare(&explain_sql)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let mut rows = stmt
        .query([])
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let mut result = String::new();
    while let Some(row) = rows.next().map_err(|e| napi::Error::from_reason(e.to_string()))? {
        let line: String = row.get(1).unwrap_or_default();
        result.push_str(&line);
        result.push('\n');
    }

    Ok(result)
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

    // Step 2: Prepare statement (using prepare_cached for caching!)
    let prepare_start = Instant::now();
    let mut stmt = conn
        .prepare_cached("SELECT x, y, tile_type, elevation FROM tiles")
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

    // Step 7: Transform data (positions + colors) using bulk slice access
    let transform_start = Instant::now();
    for batch in &batches {
        let x_vals = batch.column(0).as_any().downcast_ref::<Int32Array>().unwrap().values();
        let y_vals = batch.column(1).as_any().downcast_ref::<Int32Array>().unwrap().values();
        let type_vals = batch.column(2).as_any().downcast_ref::<Int32Array>().unwrap().values();
        let elev_vals = batch.column(3).as_any().downcast_ref::<Float32Array>().unwrap().values();

        for i in 0..batch.num_rows() {
            let x = x_vals[i] as f32 * tile_spacing;
            let y = y_vals[i] as f32 * tile_spacing;
            let z = elev_vals[i];
            let tile_type = type_vals[i];

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

    // Step 8: Pack output buffer (optimized with direct memory write)
    let pack_start = Instant::now();
    let count = total_rows as u32;
    let pos_bytes_len = positions.len() * 4;
    let col_bytes_len = colors.len() * 4;
    let total_bytes = 4 + pos_bytes_len + col_bytes_len;
    
    let mut output: Vec<u8> = Vec::with_capacity(total_bytes);
    unsafe {
        output.set_len(total_bytes);
        
        // Write count
        std::ptr::copy_nonoverlapping(
            &count as *const u32 as *const u8,
            output.as_mut_ptr(),
            4
        );
        
        // Write positions
        std::ptr::copy_nonoverlapping(
            positions.as_ptr() as *const u8,
            output.as_mut_ptr().add(4),
            pos_bytes_len
        );
        
        // Write colors  
        std::ptr::copy_nonoverlapping(
            colors.as_ptr() as *const u8,
            output.as_mut_ptr().add(4 + pos_bytes_len),
            col_bytes_len
        );
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

    // Query raw tile data (using prepare_cached for statement caching!)
    let mut stmt = conn
        .prepare_cached("SELECT x, y, tile_type, elevation FROM tiles")
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

    // Use bulk slice access for better performance
    for batch in &batches {
        let x_vals = batch.column(0).as_any().downcast_ref::<Int32Array>().unwrap().values();
        let y_vals = batch.column(1).as_any().downcast_ref::<Int32Array>().unwrap().values();
        let type_vals = batch.column(2).as_any().downcast_ref::<Int32Array>().unwrap().values();
        let elev_vals = batch.column(3).as_any().downcast_ref::<Float32Array>().unwrap().values();

        for i in 0..batch.num_rows() {
            let x = x_vals[i] as f32 * tile_spacing;
            let y = y_vals[i] as f32 * tile_spacing;
            let z = elev_vals[i];
            let tile_type = type_vals[i];

            // Position vec4 (x, y, z, w=1)
            positions.push(x);
            positions.push(y);
            positions.push(z);
            positions.push(1.0);

            // Color vec4 (r, g, b) = tile_color(tile_type, color_scale);
            let (r, g, b) = tile_color(tile_type, color_scale);
            colors.push(r);
            colors.push(g);
            colors.push(b);
            colors.push(1.0);
        }
    }

    // Pack into single buffer using direct memory write
    let count = total_rows as u32;
    let pos_bytes_len = positions.len() * 4;
    let col_bytes_len = colors.len() * 4;
    let total_bytes = 4 + pos_bytes_len + col_bytes_len;
    
    let mut output: Vec<u8> = Vec::with_capacity(total_bytes);
    unsafe {
        output.set_len(total_bytes);
        
        std::ptr::copy_nonoverlapping(
            &count as *const u32 as *const u8,
            output.as_mut_ptr(),
            4
        );
        
        std::ptr::copy_nonoverlapping(
            positions.as_ptr() as *const u8,
            output.as_mut_ptr().add(4),
            pos_bytes_len
        );
        
        std::ptr::copy_nonoverlapping(
            colors.as_ptr() as *const u8,
            output.as_mut_ptr().add(4 + pos_bytes_len),
            col_bytes_len
        );
    }

    Ok(Buffer::from(output))
}

// Global GPU data cache - computed once, served instantly
static GPU_CACHE: Lazy<Mutex<Option<Vec<u8>>>> = Lazy::new(|| Mutex::new(None));

// ============================================================================
// Polars DataFrame Cache
// ============================================================================
// DuckDB can output directly to Polars DataFrames (zero-copy via Arrow).
// We cache these DataFrames in Rust memory for repeated fast access.
// Cache key is the SQL query string, value is the resulting DataFrame.

/// Cache structure: SQL query -> Polars DataFrame
/// The DataFrame shares Arrow arrays with what DuckDB produced (near zero-copy)
struct DataFrameCache {
    /// Cached query results
    cache: HashMap<String, DataFrame>,
    /// Cache version - incremented on writes to invalidate
    version: u64,
}

impl DataFrameCache {
    fn new() -> Self {
        Self {
            cache: HashMap::new(),
            version: 0,
        }
    }
}

static POLARS_CACHE: Lazy<Mutex<DataFrameCache>> = Lazy::new(|| {
    Mutex::new(DataFrameCache::new())
});

/// Query DuckDB and return result as Polars DataFrame, with caching.
/// On cache hit: returns clone of DataFrame (~instant, shares underlying Arrow arrays)
/// On cache miss: queries DuckDB, collects to DataFrame, caches, returns clone
fn query_polars_cached(sql: &str) -> Result<DataFrame, String> {
    // Check cache first (separate lock scope)
    {
        let cache = POLARS_CACHE.lock().map_err(|e| e.to_string())?;
        if let Some(df) = cache.cache.get(sql) {
            // Clone is cheap - DataFrame columns use Arc internally
            return Ok(df.clone());
        }
    }

    // Cache miss - query DuckDB
    let conn = DB.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    
    // Use DuckDB's native Polars output - iterates over DataFrame chunks
    let polars_iter = stmt.query_polars([]).map_err(|e| e.to_string())?;
    
    // Collect all chunks and vstack them into one DataFrame
    let dataframes: Vec<DataFrame> = polars_iter.collect();
    
    if dataframes.is_empty() {
        // Return empty DataFrame
        return Ok(DataFrame::empty());
    }
    
    // Vertically stack all chunks into a single DataFrame
    let mut result = dataframes[0].clone();
    for df in dataframes.iter().skip(1) {
        result = result.vstack(df).map_err(|e| e.to_string())?;
    }
    
    // Drop connection lock, acquire cache lock
    drop(conn);
    
    // Store in cache
    {
        let mut cache = POLARS_CACHE.lock().map_err(|e| e.to_string())?;
        cache.cache.insert(sql.to_string(), result.clone());
    }
    
    Ok(result)
}

/// Invalidate the Polars cache (call after INSERT/UPDATE/DELETE)
fn invalidate_polars_cache() -> Result<(), String> {
    let mut cache = POLARS_CACHE.lock().map_err(|e| e.to_string())?;
    cache.cache.clear();
    cache.version += 1;
    Ok(())
}

/// Execute SQL and invalidate cache if it's a write operation
#[napi]
pub fn execute_with_cache(sql: String) -> napi::Result<i32> {
    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let rows = conn
        .execute(&sql, [])
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    // Invalidate cache on any write operation
    let sql_upper = sql.to_uppercase();
    if sql_upper.starts_with("INSERT")
        || sql_upper.starts_with("UPDATE")
        || sql_upper.starts_with("DELETE")
        || sql_upper.starts_with("DROP")
        || sql_upper.starts_with("CREATE")
        || sql_upper.starts_with("ALTER")
    {
        drop(conn); // Release DB lock before cache lock
        invalidate_polars_cache().map_err(|e| napi::Error::from_reason(e))?;
    }

    Ok(rows as i32)
}

/// Query tiles using Polars cache - much faster for repeated queries
/// Returns Arrow IPC buffer (same format as query())
#[napi]
pub fn query_tiles_cached() -> napi::Result<Buffer> {
    use std::time::Instant;
    let start = Instant::now();
    
    // Use cached Polars DataFrame
    let mut df = query_polars_cached("SELECT x, y, tile_type, elevation FROM tiles")
        .map_err(|e| napi::Error::from_reason(e))?;
    
    let cache_time = start.elapsed();
    
    // Convert Polars DataFrame to Arrow IPC using Polars' own writer
    let ipc_start = Instant::now();
    
    let mut buf: Vec<u8> = Vec::new();
    {
        // Use Polars' IpcWriter which handles the Arrow conversion internally
        IpcWriter::new(&mut buf)
            .finish(&mut df)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    }
    
    let ipc_time = ipc_start.elapsed();
    
    // Log timing for benchmarking
    eprintln!(
        "[Polars cache] rows={}, cache={:?}, ipc={:?}, total={:?}",
        df.height(),
        cache_time,
        ipc_time,
        start.elapsed()
    );
    
    Ok(Buffer::from(buf))
}

/// Get cache statistics
#[napi]
pub fn get_cache_stats() -> napi::Result<String> {
    let cache = POLARS_CACHE
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    let mut total_rows = 0usize;
    let mut queries: Vec<String> = Vec::new();
    
    for (sql, df) in &cache.cache {
        total_rows += df.height();
        queries.push(format!("  - {} ({} rows)", sql, df.height()));
    }
    
    Ok(format!(
        "Polars Cache v{}:\n  Entries: {}\n  Total rows: {}\n  Queries:\n{}",
        cache.version,
        cache.cache.len(),
        total_rows,
        queries.join("\n")
    ))
}

/// Clear the Polars cache manually
#[napi]
pub fn clear_polars_cache() -> napi::Result<()> {
    invalidate_polars_cache().map_err(|e| napi::Error::from_reason(e))?;
    Ok(())
}

/// Benchmark Polars cache latency with detailed timing breakdown
#[napi]
pub fn benchmark_polars_cache() -> napi::Result<String> {
    use std::time::Instant;
    
    let sql = "SELECT x, y, tile_type, elevation FROM tiles";
    
    // First call - cache miss (warm up DuckDB + populate cache)
    let cold_start = Instant::now();
    let _df = query_polars_cached(sql).map_err(|e| napi::Error::from_reason(e))?;
    let cold_us = cold_start.elapsed().as_nanos() as f64 / 1000.0;
    
    // Second call - should be cache hit
    let cache_lookup_start = Instant::now();
    let cache = POLARS_CACHE.lock().map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let lock_us = cache_lookup_start.elapsed().as_nanos() as f64 / 1000.0;
    
    let get_start = Instant::now();
    let df = cache.cache.get(sql).cloned();
    let get_us = get_start.elapsed().as_nanos() as f64 / 1000.0;
    drop(cache);
    
    let df = df.ok_or_else(|| napi::Error::from_reason("Cache miss after warm-up"))?;
    let rows = df.height();
    
    // Measure clone cost (what happens on cache hit)
    let clone_start = Instant::now();
    let mut df_clone = df.clone();
    let clone_us = clone_start.elapsed().as_nanos() as f64 / 1000.0;
    
    // Measure IPC serialization
    let ipc_start = Instant::now();
    let mut buf: Vec<u8> = Vec::new();
    IpcWriter::new(&mut buf)
        .finish(&mut df_clone)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let ipc_us = ipc_start.elapsed().as_nanos() as f64 / 1000.0;
    let ipc_bytes = buf.len();
    
    // Measure Buffer::from
    let buffer_start = Instant::now();
    let _buffer = Buffer::from(buf);
    let buffer_us = buffer_start.elapsed().as_nanos() as f64 / 1000.0;
    
    // Full hot path (cache hit → IPC → Buffer)
    let hot_start = Instant::now();
    let mut df2 = query_polars_cached(sql).map_err(|e| napi::Error::from_reason(e))?;
    let mut buf2: Vec<u8> = Vec::new();
    IpcWriter::new(&mut buf2)
        .finish(&mut df2)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let _buffer2 = Buffer::from(buf2);
    let hot_us = hot_start.elapsed().as_nanos() as f64 / 1000.0;
    
    Ok(format!(
        r#"{{
  "rows": {},
  "ipc_bytes": {},
  "cold_query_us": {:.1},
  "cache_lock_us": {:.1},
  "cache_get_us": {:.1},
  "df_clone_us": {:.1},
  "ipc_write_us": {:.1},
  "buffer_from_us": {:.1},
  "hot_path_total_us": {:.1},
  "hot_path_ms": {:.2}
}}"#,
        rows,
        ipc_bytes,
        cold_us,
        lock_us,
        get_us,
        clone_us,
        ipc_us,
        buffer_us,
        hot_us,
        hot_us / 1000.0
    ))
}

/// Precompute GPU-ready tile data and cache in Rust memory (not DuckDB).
/// This is O(n) at load time, then query_cached_tiles() is O(1).
#[napi]
pub fn precompute_tile_gpu_data(tile_spacing: f64, color_scale: f64) -> napi::Result<i32> {
    use arrow::array::{Float32Array, Int32Array};
    use std::time::Instant;

    let total_start = Instant::now();
    let tile_spacing = tile_spacing as f32;
    let color_scale = color_scale as f32;

    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    // Query all tiles
    let mut stmt = conn
        .prepare("SELECT x, y, tile_type, elevation FROM tiles")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let batches: Vec<_> = stmt
        .query_arrow([])
        .map_err(|e| napi::Error::from_reason(e.to_string()))?
        .collect();

    let total_rows: usize = batches.iter().map(|b| b.num_rows()).sum();
    let mut positions: Vec<f32> = Vec::with_capacity(total_rows * 4);
    let mut colors: Vec<f32> = Vec::with_capacity(total_rows * 4);

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

    for batch in &batches {
        let x_vals = batch.column(0).as_any().downcast_ref::<Int32Array>().unwrap().values();
        let y_vals = batch.column(1).as_any().downcast_ref::<Int32Array>().unwrap().values();
        let type_vals = batch.column(2).as_any().downcast_ref::<Int32Array>().unwrap().values();
        let elev_vals = batch.column(3).as_any().downcast_ref::<Float32Array>().unwrap().values();

        for i in 0..batch.num_rows() {
            let x = x_vals[i] as f32 * tile_spacing;
            let y = y_vals[i] as f32 * tile_spacing;
            let z = elev_vals[i];
            let tile_type = type_vals[i];

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

    // Pack into GPU-ready buffer
    let count = total_rows as u32;
    let pos_bytes_len = positions.len() * 4;
    let col_bytes_len = colors.len() * 4;
    let total_bytes = 4 + pos_bytes_len + col_bytes_len;

    let mut gpu_data: Vec<u8> = vec![0u8; total_bytes];
    unsafe {
        std::ptr::copy_nonoverlapping(&count as *const u32 as *const u8, gpu_data.as_mut_ptr(), 4);
        std::ptr::copy_nonoverlapping(positions.as_ptr() as *const u8, gpu_data.as_mut_ptr().add(4), pos_bytes_len);
        std::ptr::copy_nonoverlapping(colors.as_ptr() as *const u8, gpu_data.as_mut_ptr().add(4 + pos_bytes_len), col_bytes_len);
    }

    // Store in Rust memory cache (not DuckDB!)
    let mut cache = GPU_CACHE.lock().map_err(|e| napi::Error::from_reason(e.to_string()))?;
    *cache = Some(gpu_data);

    let elapsed_ms = total_start.elapsed().as_millis() as i32;
    Ok(elapsed_ms)
}

/// Query cached GPU data - just returns a clone of the Rust-side cache.
/// This is O(1) - no DuckDB involved!
#[napi]
pub fn query_precomputed_tiles() -> napi::Result<Buffer> {
    let cache = GPU_CACHE.lock().map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    match &*cache {
        Some(data) => Ok(Buffer::from(data.clone())),
        None => Err(napi::Error::from_reason("GPU cache not initialized. Call precomputeTileGpuData first."))
    }
}

/// Benchmark the cached query path
#[napi]
pub fn benchmark_precomputed_query() -> napi::Result<String> {
    use std::time::Instant;

    let total_start = Instant::now();

    let lock_start = Instant::now();
    let cache = GPU_CACHE.lock().map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let lock_us = lock_start.elapsed().as_nanos() as f64 / 1000.0;

    let clone_start = Instant::now();
    let data = match &*cache {
        Some(d) => d.clone(),
        None => return Err(napi::Error::from_reason("GPU cache not initialized"))
    };
    let clone_us = clone_start.elapsed().as_nanos() as f64 / 1000.0;

    let buffer_start = Instant::now();
    let _buffer = Buffer::from(data.clone());
    let buffer_us = buffer_start.elapsed().as_nanos() as f64 / 1000.0;

    let total_us = total_start.elapsed().as_nanos() as f64 / 1000.0;

    // Parse count from data
    let count = if data.len() >= 4 {
        u32::from_le_bytes([data[0], data[1], data[2], data[3]])
    } else {
        0
    };

    Ok(format!(
        r#"{{"total_us":{:.2},"rows":{},"bytes":{},"breakdown":{{"lock_us":{:.2},"clone_us":{:.2},"buffer_us":{:.2}}}}}"#,
        total_us, count, data.len(), lock_us, clone_us, buffer_us
    ))
}

// ============================================================================
// NEW ARCHITECTURE: Raw Data Export for GPU Compute
// ============================================================================
// Instead of CPU transform, export raw columns directly → GPU compute shader transforms

/// GPU-compute optimized raw data cache
static RAW_GPU_CACHE: Lazy<Mutex<Option<Vec<u8>>>> = Lazy::new(|| Mutex::new(None));

/// Export raw tile data in GPU-friendly format for compute shader processing.
/// Format: [count:u32][x:i32...][y:i32...][type:i32...][elevation:f32...]
/// The compute shader will transform this to positions/colors on GPU.
/// This eliminates ALL CPU-side transformation - just raw column export!
/// 
/// Optimizations:
/// - Uses mimalloc global allocator for fast allocation
/// - Avoids zeroing output buffer (uses uninit memory)
/// - Direct memcpy from Arrow column buffers
/// - DuckDB uses parallel execution for query
#[napi]
pub fn export_raw_tile_data() -> napi::Result<Buffer> {
    use arrow::array::{Float32Array, Int32Array};
    use std::time::Instant;

    let start = Instant::now();

    // Step 1: Acquire lock
    let lock_start = Instant::now();
    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let lock_us = lock_start.elapsed().as_micros();

    // Step 2: Prepare statement (cached)
    let prepare_start = Instant::now();
    let mut stmt = conn
        .prepare_cached("SELECT x, y, tile_type, elevation FROM tiles")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let prepare_us = prepare_start.elapsed().as_micros();

    // Step 3: Execute query (returns iterator, not materialized yet!)
    let query_start = Instant::now();
    let arrow_result = stmt
        .query_arrow([])
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let query_us = query_start.elapsed().as_micros();

    // Step 4: Collect/materialize batches (THIS is where DuckDB actually executes!)
    let collect_start = Instant::now();
    let batches: Vec<_> = arrow_result.collect();
    let collect_us = collect_start.elapsed().as_micros();

    eprintln!("[Rust] Timing: lock={}µs prepare={}µs query={}µs COLLECT={}µs", 
              lock_us, prepare_us, query_us, collect_us);

    if batches.is_empty() {
        return Ok(Buffer::from(Vec::new()));
    }

    let total_rows: usize = batches.iter().map(|b| b.num_rows()).sum();

    // Allocate: count(4) + x(4*n) + y(4*n) + type(4*n) + elev(4*n) = 4 + 16*n bytes
    // Use with_capacity + set_len to avoid zeroing (we'll overwrite everything)
    let total_bytes = 4 + total_rows * 16;
    let mut output: Vec<u8> = Vec::with_capacity(total_bytes);
    unsafe { output.set_len(total_bytes); }

    let count = total_rows as u32;
    output[0..4].copy_from_slice(&count.to_le_bytes());

    // Write columns contiguously (SoA layout - optimal for GPU)
    let mut x_offset = 4;
    let mut y_offset = 4 + total_rows * 4;
    let mut type_offset = 4 + total_rows * 8;
    let mut elev_offset = 4 + total_rows * 12;

    for batch in &batches {
        let n = batch.num_rows();
        let x_vals = batch.column(0).as_any().downcast_ref::<Int32Array>().unwrap();
        let y_vals = batch.column(1).as_any().downcast_ref::<Int32Array>().unwrap();
        let type_vals = batch.column(2).as_any().downcast_ref::<Int32Array>().unwrap();
        let elev_vals = batch.column(3).as_any().downcast_ref::<Float32Array>().unwrap();

        // Direct memcpy from Arrow buffers (zero transform!)
        unsafe {
            std::ptr::copy_nonoverlapping(
                x_vals.values().as_ptr() as *const u8,
                output.as_mut_ptr().add(x_offset),
                n * 4,
            );
            std::ptr::copy_nonoverlapping(
                y_vals.values().as_ptr() as *const u8,
                output.as_mut_ptr().add(y_offset),
                n * 4,
            );
            std::ptr::copy_nonoverlapping(
                type_vals.values().as_ptr() as *const u8,
                output.as_mut_ptr().add(type_offset),
                n * 4,
            );
            std::ptr::copy_nonoverlapping(
                elev_vals.values().as_ptr() as *const u8,
                output.as_mut_ptr().add(elev_offset),
                n * 4,
            );
        }

        x_offset += n * 4;
        y_offset += n * 4;
        type_offset += n * 4;
        elev_offset += n * 4;
    }

    let elapsed_us = start.elapsed().as_micros();
    eprintln!("[Rust] export_raw_tile_data: {} rows in {}µs ({:.2}MB)", 
              total_rows, elapsed_us, total_bytes as f64 / 1_000_000.0);

    Ok(Buffer::from(output))
}

/// Benchmark: Compare Arrow query vs raw row iteration to isolate Arrow overhead
#[napi]
pub fn benchmark_arrow_vs_native() -> napi::Result<String> {
    use std::time::Instant;

    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    // Test 1: Arrow path (current implementation)
    let arrow_start = Instant::now();
    let mut stmt = conn
        .prepare_cached("SELECT x, y, tile_type, elevation FROM tiles")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let batches: Vec<_> = stmt
        .query_arrow([])
        .map_err(|e| napi::Error::from_reason(e.to_string()))?
        .collect();
    let arrow_count: usize = batches.iter().map(|b| b.num_rows()).sum();
    let arrow_us = arrow_start.elapsed().as_micros();

    // Test 2: Native row iteration (to compare)
    let native_start = Instant::now();
    let mut stmt2 = conn
        .prepare_cached("SELECT COUNT(*) FROM tiles")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let count: i64 = stmt2
        .query_row([], |row| row.get(0))
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let native_us = native_start.elapsed().as_micros();

    // Test 3: Just TABLE_SCAN (no data movement)
    let scan_start = Instant::now();
    let mut stmt3 = conn
        .prepare_cached("SELECT 1 FROM tiles LIMIT 1")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let _one: i32 = stmt3
        .query_row([], |row| row.get(0))
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let scan_us = scan_start.elapsed().as_micros();

    // Test 4: Pure memcpy baseline (16MB of data)
    let memcpy_start = Instant::now();
    let src: Vec<u8> = vec![0u8; 16 * 1024 * 1024]; // 16MB
    let mut dst: Vec<u8> = vec![0u8; 16 * 1024 * 1024];
    unsafe {
        std::ptr::copy_nonoverlapping(src.as_ptr(), dst.as_mut_ptr(), 16 * 1024 * 1024);
    }
    std::hint::black_box(&dst); // Prevent optimization
    let memcpy_us = memcpy_start.elapsed().as_micros();

    // Test 5: Allocation speed (16MB)
    let alloc_start = Instant::now();
    let data: Vec<u8> = Vec::with_capacity(16 * 1024 * 1024);
    std::hint::black_box(&data);
    let alloc_us = alloc_start.elapsed().as_micros();

    Ok(format!(
        r#"{{"arrow_materialize_us": {}, "native_count_us": {}, "scan_limit1_us": {}, "memcpy_16mb_us": {}, "alloc_16mb_us": {}, "arrow_rows": {}, "native_count": {}}}"#,
        arrow_us, native_us, scan_us, memcpy_us, alloc_us, arrow_count, count
    ))
}

/// Benchmark different DuckDB settings for Arrow export performance
/// Tests various configurations to find optimal settings
#[napi]
pub fn benchmark_duckdb_settings() -> napi::Result<String> {
    use std::time::Instant;

    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let mut results = Vec::new();

    // Get current settings
    let threads: i32 = conn
        .query_row("SELECT current_setting('threads')::INT", [], |row| row.get(0))
        .unwrap_or(-1);
    let memory_limit: String = conn
        .query_row("SELECT current_setting('memory_limit')", [], |row| row.get(0))
        .unwrap_or_default();

    results.push(format!(r#""current_threads": {}"#, threads));
    results.push(format!(r#""current_memory_limit": "{}""#, memory_limit));

    // Test 1: Default settings (already applied)
    let start = Instant::now();
    let mut stmt = conn
        .prepare_cached("SELECT x, y, tile_type, elevation FROM tiles")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let batches: Vec<_> = stmt.query_arrow([]).map_err(|e| napi::Error::from_reason(e.to_string()))?.collect();
    let default_us = start.elapsed().as_micros();
    let batch_count = batches.len();
    let row_count: usize = batches.iter().map(|b| b.num_rows()).sum();
    results.push(format!(r#""default_us": {}"#, default_us));
    results.push(format!(r#""batch_count": {}"#, batch_count));
    results.push(format!(r#""total_rows": {}"#, row_count));

    // Test 2: With preserve_insertion_order = false (may allow more parallelism)
    conn.execute_batch("SET preserve_insertion_order = false").ok();
    let start = Instant::now();
    let mut stmt = conn
        .prepare_cached("SELECT x, y, tile_type, elevation FROM tiles")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let _batches: Vec<_> = stmt.query_arrow([]).map_err(|e| napi::Error::from_reason(e.to_string()))?.collect();
    let no_order_us = start.elapsed().as_micros();
    results.push(format!(r#""no_preserve_order_us": {}"#, no_order_us));
    conn.execute_batch("SET preserve_insertion_order = true").ok(); // restore

    // Test 3: Different thread counts
    for thread_count in [1, 2, 4, 8] {
        conn.execute_batch(&format!("SET threads TO {}", thread_count)).ok();
        let start = Instant::now();
        let mut stmt = conn
            .prepare_cached("SELECT x, y, tile_type, elevation FROM tiles")
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        let _batches: Vec<_> = stmt.query_arrow([]).map_err(|e| napi::Error::from_reason(e.to_string()))?.collect();
        let us = start.elapsed().as_micros();
        results.push(format!(r#""threads_{}_us": {}"#, thread_count, us));
    }
    conn.execute_batch("SET threads TO 8").ok(); // restore

    // Test 4: Row-based query for comparison (not Arrow)
    let start = Instant::now();
    let mut stmt = conn
        .prepare_cached("SELECT x, y, tile_type, elevation FROM tiles")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let mut rows = stmt.query([]).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let mut count = 0usize;
    while let Some(_row) = rows.next().map_err(|e| napi::Error::from_reason(e.to_string()))? {
        count += 1;
    }
    let row_iter_us = start.elapsed().as_micros();
    results.push(format!(r#""row_iterator_us": {}"#, row_iter_us));
    results.push(format!(r#""row_iterator_count": {}"#, count));

    Ok(format!("{{{}}}", results.join(", ")))
}

/// Get storage info for the tiles table showing compression used
/// Returns JSON with column compression types
#[napi]
pub fn get_storage_info() -> napi::Result<String> {
    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    // Check current force_compression setting
    let force_compression: String = conn
        .query_row("SELECT current_setting('force_compression')", [], |row| row.get(0))
        .unwrap_or_else(|_| "unknown".to_string());

    // Query PRAGMA storage_info for tiles table
    let mut stmt = conn
        .prepare("SELECT column_name, compression, COUNT(*) as segment_count FROM pragma_storage_info('tiles') GROUP BY column_name, compression")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let mut rows = stmt.query([]).map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let mut columns = Vec::new();
    while let Some(row) = rows.next().map_err(|e| napi::Error::from_reason(e.to_string()))? {
        let col_name: String = row.get(0).unwrap_or_default();
        let compression: String = row.get(1).unwrap_or_default();
        let seg_count: i64 = row.get(2).unwrap_or(0);
        columns.push(format!(r#"{{"column": "{}", "compression": "{}", "segments": {}}}"#, col_name, compression, seg_count));
    }

    Ok(format!(r#"{{"force_compression": "{}", "columns": [{}]}}"#, force_compression, columns.join(", ")))
}

/// Benchmark compressed vs uncompressed storage
/// Creates two test tables and compares read performance
#[napi]
pub fn benchmark_compression() -> napi::Result<String> {
    use std::time::Instant;

    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let mut results = Vec::new();

    // First, get current compression setting
    let force_compression: String = conn
        .query_row("SELECT current_setting('force_compression')", [], |row| row.get(0))
        .unwrap_or_else(|_| "auto".to_string());
    results.push(format!(r#""current_force_compression": "{}""#, force_compression));

    // Test reading from main tiles table (uses current setting)
    let start = Instant::now();
    let mut stmt = conn
        .prepare_cached("SELECT x, y, tile_type, elevation FROM tiles")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let batches: Vec<_> = stmt.query_arrow([]).map_err(|e| napi::Error::from_reason(e.to_string()))?.collect();
    let current_us = start.elapsed().as_micros();
    let row_count: usize = batches.iter().map(|b| b.num_rows()).sum();
    results.push(format!(r#""current_read_us": {}"#, current_us));
    results.push(format!(r#""row_count": {}"#, row_count));

    // IMPORTANT: Temporarily reset force_compression to AUTO to allow per-table compression
    conn.execute_batch("SET force_compression = 'auto'").ok();

    // Create uncompressed test table (explicit per-column compression)
    conn.execute_batch("
        DROP TABLE IF EXISTS test_uncompressed;
        CREATE TABLE test_uncompressed (
            x INTEGER USING COMPRESSION UNCOMPRESSED,
            y INTEGER USING COMPRESSION UNCOMPRESSED,
            tile_type INTEGER USING COMPRESSION UNCOMPRESSED,
            elevation FLOAT USING COMPRESSION UNCOMPRESSED
        );
        INSERT INTO test_uncompressed SELECT x, y, tile_type, elevation FROM tiles;
    ").map_err(|e| napi::Error::from_reason(e.to_string()))?;

    // Create bitpacking compressed test table
    conn.execute_batch("
        DROP TABLE IF EXISTS test_bitpacked;
        CREATE TABLE test_bitpacked (
            x INTEGER USING COMPRESSION BITPACKING,
            y INTEGER USING COMPRESSION BITPACKING,
            tile_type INTEGER USING COMPRESSION BITPACKING,
            elevation FLOAT
        );
        INSERT INTO test_bitpacked SELECT x, y, tile_type, elevation FROM tiles;
    ").map_err(|e| napi::Error::from_reason(e.to_string()))?;

    // Checkpoint to ensure compression is applied
    conn.execute_batch("CHECKPOINT").ok();

    // Restore global uncompressed setting (for main tiles table)
    conn.execute_batch("SET force_compression = 'uncompressed'").ok();

    // Benchmark uncompressed table
    let start = Instant::now();
    let mut stmt = conn
        .prepare("SELECT x, y, tile_type, elevation FROM test_uncompressed")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let _batches: Vec<_> = stmt.query_arrow([]).map_err(|e| napi::Error::from_reason(e.to_string()))?.collect();
    let uncompressed_us = start.elapsed().as_micros();
    results.push(format!(r#""uncompressed_read_us": {}"#, uncompressed_us));

    // Benchmark bitpacked table
    let start = Instant::now();
    let mut stmt = conn
        .prepare("SELECT x, y, tile_type, elevation FROM test_bitpacked")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let _batches: Vec<_> = stmt.query_arrow([]).map_err(|e| napi::Error::from_reason(e.to_string()))?.collect();
    let bitpacked_us = start.elapsed().as_micros();
    results.push(format!(r#""bitpacked_read_us": {}"#, bitpacked_us));

    // Get storage info for both tables
    let uncompressed_info: String = conn
        .query_row("SELECT compression FROM pragma_storage_info('test_uncompressed') WHERE column_name = 'x' LIMIT 1", [], |row| row.get(0))
        .unwrap_or_else(|_| "unknown".to_string());
    let bitpacked_info: String = conn
        .query_row("SELECT compression FROM pragma_storage_info('test_bitpacked') WHERE column_name = 'x' LIMIT 1", [], |row| row.get(0))
        .unwrap_or_else(|_| "unknown".to_string());

    results.push(format!(r#""uncompressed_actual": "{}""#, uncompressed_info));
    results.push(format!(r#""bitpacked_actual": "{}""#, bitpacked_info));

    // Calculate speedup
    let speedup = if uncompressed_us > 0 { bitpacked_us as f64 / uncompressed_us as f64 } else { 1.0 };
    results.push(format!(r#""speedup_ratio": {:.2}"#, speedup));

    // Cleanup
    conn.execute_batch("DROP TABLE IF EXISTS test_uncompressed; DROP TABLE IF EXISTS test_bitpacked;").ok();

    Ok(format!("{{{}}}", results.join(", ")))
}

/// Cache raw tile data in Rust memory for repeated access
/// Uses uninitialized memory allocation for speed
#[napi]
pub fn cache_raw_tile_data() -> napi::Result<i32> {
    use arrow::array::{Float32Array, Int32Array};
    use std::time::Instant;

    let start = Instant::now();

    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let mut stmt = conn
        .prepare_cached("SELECT x, y, tile_type, elevation FROM tiles")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let batches: Vec<_> = stmt
        .query_arrow([])
        .map_err(|e| napi::Error::from_reason(e.to_string()))?
        .collect();

    if batches.is_empty() {
        return Ok(0);
    }

    let total_rows: usize = batches.iter().map(|b| b.num_rows()).sum();
    let total_bytes = 4 + total_rows * 16;
    
    // Use with_capacity + set_len to avoid zeroing (we'll overwrite everything)
    let mut output: Vec<u8> = Vec::with_capacity(total_bytes);
    unsafe { output.set_len(total_bytes); }

    let count = total_rows as u32;
    output[0..4].copy_from_slice(&count.to_le_bytes());

    let mut x_offset = 4;
    let mut y_offset = 4 + total_rows * 4;
    let mut type_offset = 4 + total_rows * 8;
    let mut elev_offset = 4 + total_rows * 12;

    for batch in &batches {
        let n = batch.num_rows();
        let x_vals = batch.column(0).as_any().downcast_ref::<Int32Array>().unwrap();
        let y_vals = batch.column(1).as_any().downcast_ref::<Int32Array>().unwrap();
        let type_vals = batch.column(2).as_any().downcast_ref::<Int32Array>().unwrap();
        let elev_vals = batch.column(3).as_any().downcast_ref::<Float32Array>().unwrap();

        unsafe {
            std::ptr::copy_nonoverlapping(x_vals.values().as_ptr() as *const u8, output.as_mut_ptr().add(x_offset), n * 4);
            std::ptr::copy_nonoverlapping(y_vals.values().as_ptr() as *const u8, output.as_mut_ptr().add(y_offset), n * 4);
            std::ptr::copy_nonoverlapping(type_vals.values().as_ptr() as *const u8, output.as_mut_ptr().add(type_offset), n * 4);
            std::ptr::copy_nonoverlapping(elev_vals.values().as_ptr() as *const u8, output.as_mut_ptr().add(elev_offset), n * 4);
        }

        x_offset += n * 4;
        y_offset += n * 4;
        type_offset += n * 4;
        elev_offset += n * 4;
    }

    // Store in cache
    let mut cache = RAW_GPU_CACHE.lock().map_err(|e| napi::Error::from_reason(e.to_string()))?;
    *cache = Some(output);

    Ok(start.elapsed().as_millis() as i32)
}

/// Get cached raw tile data (fast path - just clone cached bytes)
#[napi]
pub fn get_cached_raw_tiles() -> napi::Result<Buffer> {
    let cache = RAW_GPU_CACHE.lock().map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    match &*cache {
        Some(data) => Ok(Buffer::from(data.clone())),
        None => Err(napi::Error::from_reason("Raw tile cache not initialized. Call cacheRawTileData first."))
    }
}

/// Benchmark raw export vs CPU-transformed export
#[napi]
pub fn benchmark_raw_export() -> napi::Result<String> {
    use arrow::array::{Float32Array, Int32Array};
    use std::time::Instant;

    let total_start = Instant::now();

    let lock_start = Instant::now();
    let conn = DB.lock().map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let lock_us = lock_start.elapsed().as_nanos() as f64 / 1000.0;

    let prepare_start = Instant::now();
    let mut stmt = conn
        .prepare_cached("SELECT x, y, tile_type, elevation FROM tiles")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let prepare_us = prepare_start.elapsed().as_nanos() as f64 / 1000.0;

    let query_start = Instant::now();
    let arrow_result = stmt.query_arrow([]).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let query_us = query_start.elapsed().as_nanos() as f64 / 1000.0;

    let collect_start = Instant::now();
    let batches: Vec<_> = arrow_result.collect();
    let collect_us = collect_start.elapsed().as_nanos() as f64 / 1000.0;

    let total_rows: usize = batches.iter().map(|b| b.num_rows()).sum();

    // Raw export - just memcpy columns
    let export_start = Instant::now();
    let total_bytes = 4 + total_rows * 16;
    let mut output: Vec<u8> = vec![0u8; total_bytes];
    let count = total_rows as u32;
    output[0..4].copy_from_slice(&count.to_le_bytes());

    let mut x_off = 4;
    let mut y_off = 4 + total_rows * 4;
    let mut t_off = 4 + total_rows * 8;
    let mut e_off = 4 + total_rows * 12;

    for batch in &batches {
        let n = batch.num_rows();
        let x = batch.column(0).as_any().downcast_ref::<Int32Array>().unwrap();
        let y = batch.column(1).as_any().downcast_ref::<Int32Array>().unwrap();
        let t = batch.column(2).as_any().downcast_ref::<Int32Array>().unwrap();
        let e = batch.column(3).as_any().downcast_ref::<Float32Array>().unwrap();

        unsafe {
            std::ptr::copy_nonoverlapping(x.values().as_ptr() as *const u8, output.as_mut_ptr().add(x_off), n * 4);
            std::ptr::copy_nonoverlapping(y.values().as_ptr() as *const u8, output.as_mut_ptr().add(y_off), n * 4);
            std::ptr::copy_nonoverlapping(t.values().as_ptr() as *const u8, output.as_mut_ptr().add(t_off), n * 4);
            std::ptr::copy_nonoverlapping(e.values().as_ptr() as *const u8, output.as_mut_ptr().add(e_off), n * 4);
        }
        x_off += n * 4;
        y_off += n * 4;
        t_off += n * 4;
        e_off += n * 4;
    }
    let export_us = export_start.elapsed().as_nanos() as f64 / 1000.0;

    let buffer_start = Instant::now();
    let _buf = Buffer::from(output);
    let buffer_us = buffer_start.elapsed().as_nanos() as f64 / 1000.0;

    let total_us = total_start.elapsed().as_nanos() as f64 / 1000.0;

    Ok(format!(
        r#"{{"total_us":{:.2},"rows":{},"bytes":{},"breakdown":{{"lock_us":{:.2},"prepare_us":{:.2},"query_us":{:.2},"collect_us":{:.2},"export_us":{:.2},"buffer_us":{:.2}}}}}"#,
        total_us, total_rows, total_bytes, lock_us, prepare_us, query_us, collect_us, export_us, buffer_us
    ))
}

/// Benchmark cached raw export
#[napi]
pub fn benchmark_cached_raw() -> napi::Result<String> {
    use std::time::Instant;

    let total_start = Instant::now();

    let lock_start = Instant::now();
    let cache = RAW_GPU_CACHE.lock().map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let lock_us = lock_start.elapsed().as_nanos() as f64 / 1000.0;

    let clone_start = Instant::now();
    let data = match &*cache {
        Some(d) => d.clone(),
        None => return Err(napi::Error::from_reason("Cache not initialized"))
    };
    let clone_us = clone_start.elapsed().as_nanos() as f64 / 1000.0;

    let buffer_start = Instant::now();
    let _buf = Buffer::from(data.clone());
    let buffer_us = buffer_start.elapsed().as_nanos() as f64 / 1000.0;

    let total_us = total_start.elapsed().as_nanos() as f64 / 1000.0;

    let count = if data.len() >= 4 {
        u32::from_le_bytes([data[0], data[1], data[2], data[3]])
    } else { 0 };

    Ok(format!(
        r#"{{"total_us":{:.2},"rows":{},"bytes":{},"breakdown":{{"lock_us":{:.2},"clone_us":{:.2},"buffer_us":{:.2}}}}}"#,
        total_us, count, data.len(), lock_us, clone_us, buffer_us
    ))
}

/// Generate tile chunks with precomputed GPU data stored as BLOBs
/// This precomputes positions/colors at insert time for zero runtime transform
#[napi]
pub fn generate_tile_chunks(
    grid_size: i32,
    chunk_size: i32,
    tile_spacing: f64,
    color_scale: f64,
) -> napi::Result<()> {
    use arrow::array::{Float32Array, Int32Array};

    let tile_spacing = tile_spacing as f32;
    let color_scale = color_scale as f32;
    let chunks_per_side = grid_size / chunk_size;

    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

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

    // Process each chunk
    for cy in 0..chunks_per_side {
        for cx in 0..chunks_per_side {
            let x_min = cx * chunk_size;
            let x_max = x_min + chunk_size;
            let y_min = cy * chunk_size;
            let y_max = y_min + chunk_size;

            // Query tiles for this chunk (already in order due to insertion pattern)
            let mut stmt = conn
                .prepare_cached(
                    "SELECT x, y, tile_type, elevation FROM temp_tiles 
                     WHERE x >= ?1 AND x < ?2 AND y >= ?3 AND y < ?4",
                )
                .map_err(|e| napi::Error::from_reason(e.to_string()))?;

            let batches: Vec<_> = stmt
                .query_arrow([x_min, x_max, y_min, y_max])
                .map_err(|e| napi::Error::from_reason(e.to_string()))?
                .collect();

            let total_rows: usize = batches.iter().map(|b| b.num_rows()).sum();
            let mut positions: Vec<f32> = Vec::with_capacity(total_rows * 4);
            let mut colors: Vec<f32> = Vec::with_capacity(total_rows * 4);

            for batch in &batches {
                let x_vals = batch.column(0).as_any().downcast_ref::<Int32Array>().unwrap().values();
                let y_vals = batch.column(1).as_any().downcast_ref::<Int32Array>().unwrap().values();
                let type_vals = batch.column(2).as_any().downcast_ref::<Int32Array>().unwrap().values();
                let elev_vals = batch.column(3).as_any().downcast_ref::<Float32Array>().unwrap().values();

                for i in 0..batch.num_rows() {
                    let x = x_vals[i] as f32 * tile_spacing;
                    let y = y_vals[i] as f32 * tile_spacing;
                    let z = elev_vals[i];
                    let tile_type = type_vals[i];

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

            // Pack into GPU-ready format: [count:u32][positions...][colors...]
            let count = total_rows as u32;
            let pos_bytes_len = positions.len() * 4;
            let col_bytes_len = colors.len() * 4;
            let total_bytes = 4 + pos_bytes_len + col_bytes_len;

            let mut gpu_data: Vec<u8> = vec![0u8; total_bytes];
            unsafe {
                std::ptr::copy_nonoverlapping(
                    &count as *const u32 as *const u8,
                    gpu_data.as_mut_ptr(),
                    4,
                );
                std::ptr::copy_nonoverlapping(
                    positions.as_ptr() as *const u8,
                    gpu_data.as_mut_ptr().add(4),
                    pos_bytes_len,
                );
                std::ptr::copy_nonoverlapping(
                    colors.as_ptr() as *const u8,
                    gpu_data.as_mut_ptr().add(4 + pos_bytes_len),
                    col_bytes_len,
                );
            }

            // Insert chunk with precomputed GPU data
            conn.execute(
                "INSERT INTO tile_chunks (chunk_x, chunk_y, gpu_data) VALUES (?1, ?2, ?3)",
                duckdb::params![cx, cy, gpu_data],
            )
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        }
    }

    Ok(())
}

/// Query all tile chunks and combine into single GPU-ready buffer
#[napi]
pub fn query_chunked_tiles() -> napi::Result<Buffer> {
    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    // Query all chunks in order
    let mut stmt = conn
        .prepare_cached("SELECT gpu_data FROM tile_chunks ORDER BY chunk_y, chunk_x")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let mut rows = stmt
        .query([])
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    // Collect all chunk data
    let mut all_positions: Vec<u8> = Vec::new();
    let mut all_colors: Vec<u8> = Vec::new();
    let mut total_count: u32 = 0;

    while let Some(row) = rows.next().map_err(|e| napi::Error::from_reason(e.to_string()))? {
        let gpu_data: Vec<u8> = row.get(0).map_err(|e| napi::Error::from_reason(e.to_string()))?;
        
        if gpu_data.len() < 4 {
            continue;
        }

        // Parse chunk format: [count:u32][positions...][colors...]
        let count = u32::from_le_bytes([gpu_data[0], gpu_data[1], gpu_data[2], gpu_data[3]]);
        let pos_bytes = count as usize * 16; // 4 floats * 4 bytes
        
        if gpu_data.len() >= 4 + pos_bytes * 2 {
            all_positions.extend_from_slice(&gpu_data[4..4 + pos_bytes]);
            all_colors.extend_from_slice(&gpu_data[4 + pos_bytes..]);
            total_count += count;
        }
    }

    // Combine into final buffer
    let total_bytes = 4 + all_positions.len() + all_colors.len();
    let mut output: Vec<u8> = Vec::with_capacity(total_bytes);
    output.extend_from_slice(&total_count.to_le_bytes());
    output.extend_from_slice(&all_positions);
    output.extend_from_slice(&all_colors);

    Ok(Buffer::from(output))
}

/// Benchmark chunked query (minimal overhead - just fetch precomputed BLOBs)
#[napi]
pub fn benchmark_chunked_query() -> napi::Result<String> {
    use std::time::Instant;

    let total_start = Instant::now();

    // Step 1: Lock
    let lock_start = Instant::now();
    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let lock_us = lock_start.elapsed().as_nanos() as f64 / 1000.0;

    // Step 2: Prepare
    let prepare_start = Instant::now();
    let mut stmt = conn
        .prepare_cached("SELECT gpu_data FROM tile_chunks ORDER BY chunk_y, chunk_x")
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let prepare_us = prepare_start.elapsed().as_nanos() as f64 / 1000.0;

    // Step 3: Query
    let query_start = Instant::now();
    let mut rows = stmt
        .query([])
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let query_us = query_start.elapsed().as_nanos() as f64 / 1000.0;

    // Step 4: Collect and combine
    let collect_start = Instant::now();
    let mut all_positions: Vec<u8> = Vec::new();
    let mut all_colors: Vec<u8> = Vec::new();
    let mut total_count: u32 = 0;
    let mut chunk_count = 0;

    while let Some(row) = rows.next().map_err(|e| napi::Error::from_reason(e.to_string()))? {
        let gpu_data: Vec<u8> = row.get(0).map_err(|e| napi::Error::from_reason(e.to_string()))?;
        chunk_count += 1;
        
        if gpu_data.len() < 4 {
            continue;
        }

        let count = u32::from_le_bytes([gpu_data[0], gpu_data[1], gpu_data[2], gpu_data[3]]);
        let pos_bytes = count as usize * 16;
        
        if gpu_data.len() >= 4 + pos_bytes * 2 {
            all_positions.extend_from_slice(&gpu_data[4..4 + pos_bytes]);
            all_colors.extend_from_slice(&gpu_data[4 + pos_bytes..]);
            total_count += count;
        }
    }
    let collect_us = collect_start.elapsed().as_nanos() as f64 / 1000.0;

    // Step 5: Pack final buffer
    let pack_start = Instant::now();
    let total_bytes = 4 + all_positions.len() + all_colors.len();
    let mut output: Vec<u8> = Vec::with_capacity(total_bytes);
    output.extend_from_slice(&total_count.to_le_bytes());
    output.extend_from_slice(&all_positions);
    output.extend_from_slice(&all_colors);
    let pack_us = pack_start.elapsed().as_nanos() as f64 / 1000.0;

    // Step 6: Create buffer
    let buffer_start = Instant::now();
    let _buffer = Buffer::from(output);
    let buffer_us = buffer_start.elapsed().as_nanos() as f64 / 1000.0;

    let total_us = total_start.elapsed().as_nanos() as f64 / 1000.0;

    Ok(format!(
        r#"{{"total_us":{:.2},"rows":{},"chunks":{},"breakdown":{{"lock_us":{:.2},"prepare_us":{:.2},"query_us":{:.2},"collect_us":{:.2},"pack_us":{:.2},"buffer_us":{:.2}}}}}"#,
        total_us, total_count, chunk_count, lock_us, prepare_us, query_us, collect_us, pack_us, buffer_us
    ))
}

// ============================================================================
// 3D VOXEL SYSTEM - Minimal DuckDB → Arrow → GPU pipeline
// ============================================================================
// Coordinate system (WebGPU-native, Y-up):
//   x: 0..31 (right)
//   y: 0..63 (up/height)
//   z: 0..31 (forward/depth)
// ============================================================================

/// Create voxel chunk table and populate with sample terrain
/// Chunk size: 32×64×32 = 65,536 voxels (X × Y-height × Z-depth)
#[napi]
pub fn create_voxel_world(chunk_x: i32, chunk_z: i32) -> napi::Result<String> {
    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    // Create voxels table if not exists
    // Coordinate system: x (right 0-31), y (up/height 0-63), z (depth 0-31)
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS voxels (
            chunk_x INTEGER,
            chunk_z INTEGER,
            x UTINYINT,
            y UTINYINT,
            z UTINYINT,
            block_type UTINYINT,
            PRIMARY KEY (chunk_x, chunk_z, x, y, z)
        )"
    ).map_err(|e| napi::Error::from_reason(e.to_string()))?;

    // Clear any existing data for this chunk
    conn.execute(
        "DELETE FROM voxels WHERE chunk_x = ?1 AND chunk_z = ?2",
        duckdb::params![chunk_x, chunk_z],
    ).map_err(|e| napi::Error::from_reason(e.to_string()))?;

    // Generate terrain for this chunk
    // Simple terrain: stone below, dirt, grass on top, air above
    // Coordinate system: x (0-31), y (0-63 height, 0=bottom, 63=top), z (0-31 depth)
    // Terrain surface at y=32, so grass at y=32, stone/dirt below, air above
    // NOTE: Must use integer division (i // 1024) not float division (i / 1024)
    // 
    // CRITICAL: Block types by Y position:
    //   y > 32: air (type 0) - sky above terrain
    //   y = 32: grass (type 1) - top surface  
    //   y = 29-31: dirt (type 2) - just below grass
    //   y < 29: stone (type 3) - deep underground
    let sql = format!(
        "INSERT INTO voxels
         SELECT 
            {chunk_x} as chunk_x,
            {chunk_z} as chunk_z,
            (i % 32)::UTINYINT as x,
            (i // 1024)::UTINYINT as y,
            ((i // 32) % 32)::UTINYINT as z,
            CASE 
                -- Air above y=32 (sky)
                WHEN (i // 1024) > 32 THEN 0
                -- Grass at y=32 (surface)
                WHEN (i // 1024) = 32 THEN 1
                -- Dirt for y=29,30,31 (subsurface)
                WHEN (i // 1024) > 28 THEN 2
                -- Stone below y=29 (deep)
                ELSE 3
            END::UTINYINT as block_type
         FROM generate_series(0, 32*32*64 - 1) t(i)",
        chunk_x = chunk_x,
        chunk_z = chunk_z
    );
    
    let start = std::time::Instant::now();
    conn.execute(&sql, [])
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let elapsed = start.elapsed();

    Ok(format!(
        r#"{{"chunk_x":{},"chunk_z":{},"voxels":65536,"time_ms":{:.1}}}"#,
        chunk_x, chunk_z, elapsed.as_secs_f64() * 1000.0
    ))
}

/// Query voxels for a chunk, returning only non-air blocks as Arrow IPC
/// Returns: Arrow IPC buffer with columns (x, y, z, block_type) as u8
#[napi]
pub fn query_voxel_chunk(chunk_x: i32, chunk_z: i32) -> napi::Result<Buffer> {
    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let sql = format!(
        "SELECT x, y, z, block_type FROM voxels 
         WHERE chunk_x = {} AND chunk_z = {} AND block_type > 0
         ORDER BY z, y, x",
        chunk_x, chunk_z
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let arrow_result = stmt
        .query_arrow([])
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let batches: Vec<_> = arrow_result.collect();

    if batches.is_empty() {
        return Ok(Buffer::from(Vec::new()));
    }

    let schema = batches[0].schema();
    let mut buf: Vec<u8> = Vec::new();

    {
        let mut writer = StreamWriter::try_new(&mut buf, &schema)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;

        for batch in &batches {
            writer.write(batch)
                .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        }

        writer.finish()
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    }

    Ok(Buffer::from(buf))
}

/// Query voxels as raw typed arrays (faster than Arrow for small data)
/// Returns: Binary buffer with [count:u32, x:u8[], y:u8[], z:u8[], type:u8[]]
#[napi]
pub fn query_voxel_chunk_raw(chunk_x: i32, chunk_z: i32) -> napi::Result<Buffer> {
    use arrow::array::UInt8Array;
    
    let conn = DB
        .lock()
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let sql = format!(
        "SELECT x, y, z, block_type FROM voxels 
         WHERE chunk_x = {} AND chunk_z = {} AND block_type > 0",
        chunk_x, chunk_z
    );

    let mut stmt = conn
        .prepare_cached(&sql)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let arrow_result = stmt
        .query_arrow([])
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let batches: Vec<_> = arrow_result.collect();

    if batches.is_empty() {
        let empty: Vec<u8> = vec![0, 0, 0, 0]; // count = 0
        return Ok(Buffer::from(empty));
    }

    // Count total rows
    let total_rows: usize = batches.iter().map(|b| b.num_rows()).sum();

    // Pack: [count:u32, x[], y[], z[], type[]]
    let mut output: Vec<u8> = Vec::with_capacity(4 + total_rows * 4);
    output.extend_from_slice(&(total_rows as u32).to_le_bytes());

    // Extract each column
    for col_idx in 0..4 {
        for batch in &batches {
            let col = batch.column(col_idx);
            let arr = col.as_any().downcast_ref::<UInt8Array>()
                .ok_or_else(|| napi::Error::from_reason("Expected u8 array"))?;
            output.extend_from_slice(arr.values());
        }
    }

    Ok(Buffer::from(output))
}

/// Benchmark the voxel query pipeline
#[napi]
pub fn benchmark_voxel_query(chunk_x: i32, chunk_z: i32) -> napi::Result<String> {
    use std::time::Instant;

    let total_start = Instant::now();

    // Query raw
    let query_start = Instant::now();
    let buffer = query_voxel_chunk_raw(chunk_x, chunk_z)?;
    let query_ms = query_start.elapsed().as_secs_f64() * 1000.0;

    // Parse count
    let count = if buffer.len() >= 4 {
        u32::from_le_bytes([buffer[0], buffer[1], buffer[2], buffer[3]])
    } else {
        0
    };

    let total_ms = total_start.elapsed().as_secs_f64() * 1000.0;

    Ok(format!(
        r#"{{"total_ms":{:.2},"query_ms":{:.2},"voxels":{},"bytes":{}}}"#,
        total_ms, query_ms, count, buffer.len()
    ))
}
