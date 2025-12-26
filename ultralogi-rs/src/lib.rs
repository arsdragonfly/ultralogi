// Use mimalloc for fast, consistent allocation latency (important for real-time game ticks)
use mimalloc::MiMalloc;

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

#[macro_use]
extern crate napi_derive;

use duckdb::Connection;
use once_cell::sync::Lazy;
use serde::Serialize;
use std::sync::Mutex;

// Global DuckDB connection - thread-safe via Mutex
static DB: Lazy<Mutex<Connection>> = Lazy::new(|| {
    let conn = Connection::open_in_memory().expect("Failed to create DuckDB connection");
    
    // Configure for low-latency single-threaded operation
    conn.execute_batch("SET threads = 1;").ok();
    
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

/// Execute SQL - supports both queries (SELECT) and statements (INSERT/UPDATE/DELETE)
/// Returns QueryResult containing success, message, rows_affected, and data
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
