// Use mimalloc for fast, consistent allocation latency (important for real-time game ticks)
use mimalloc::MiMalloc;

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

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
    Mutex::new(conn)
});

/// Hello world function - test the napi binding
#[napi]
pub fn hello(name: String) -> String {
    format!("Hello, {}! Ultralogi engine ready.", name)
}

/// Execute a SQL statement (INSERT, UPDATE, DELETE, CREATE, etc.)
/// Returns the number of rows affected.
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

/// Query and return results as Arrow IPC stream.
/// This is the fastest path - zero JSON serialization, typed arrays.
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
    
    // Get schema from the result
    let schema = arrow_result.get_schema();
    
    // Collect batches
    let batches: Vec<_> = arrow_result.collect();
    
    if batches.is_empty() {
        return Ok(Buffer::from(Vec::new()));
    }
    
    // Write to Arrow IPC stream format
    let mut buffer = Vec::new();
    {
        let mut writer = StreamWriter::try_new(&mut buffer, &schema)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        
        for batch in &batches {
            writer
                .write(batch)
                .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        }
        
        writer
            .finish()
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    }
    
    Ok(Buffer::from(buffer))
}
