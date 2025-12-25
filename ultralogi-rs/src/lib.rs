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
