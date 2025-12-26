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
use serde::Serialize;
use std::sync::Mutex;

// Global DuckDB connection - thread-safe via Mutex
static DB: Lazy<Mutex<Connection>> = Lazy::new(|| {
    let conn = Connection::open_in_memory().expect("Failed to create DuckDB connection");
    Mutex::new(conn)
});

#[derive(Clone, Serialize)]
#[napi(object)]
pub struct QueryResult {
    pub success: bool,
    pub message: String,
    pub rows_affected: Option<i32>,
    pub data: Option<String>,
}

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

/// Execute SQL - supports both queries (SELECT) and statements (INSERT/UPDATE/DELETE)
/// Returns QueryResult containing success, message, rows_affected, and data
/// @deprecated Use execute() for statements and query() for SELECT queries
#[napi]
pub fn execute_sql(sql: String) -> QueryResult {
    let conn = match DB.lock() {
        Ok(c) => c,
        Err(e) => {
            return QueryResult {
                success: false,
                message: e.to_string(),
                rows_affected: None,
                data: None,
            };
        }
    };
    
    let sql_trimmed = sql.trim().to_uppercase();
    
    // Check if this is a SELECT query
    if sql_trimmed.starts_with("SELECT") {
        // Use DuckDB's built-in JSON export for queries
        let json_result = conn.query_row(
            &format!("SELECT json_group_array(row_to_json(t)) FROM ({}) t", sql),
            [],
            |row| row.get::<_, String>(0),
        );
        
        match json_result {
            Ok(json) => QueryResult {
                success: true,
                message: "OK".to_string(),
                rows_affected: None,
                data: Some(json),
            },
            Err(e) => QueryResult {
                success: false,
                message: e.to_string(),
                rows_affected: None,
                data: None,
            },
        }
    } else {
        // Execute as a statement (INSERT, UPDATE, DELETE, CREATE, etc.)
        match conn.execute(&sql, []) {
            Ok(rows) => QueryResult {
                success: true,
                message: "OK".to_string(),
                rows_affected: Some(rows as i32),
                data: None,
            },
            Err(e) => QueryResult {
                success: false,
                message: e.to_string(),
                rows_affected: None,
                data: None,
            },
        }
    }
}
