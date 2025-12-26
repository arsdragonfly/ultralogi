/// <reference path="../types/interface.d.ts" />
import { tableFromIPC, Table } from 'apache-arrow';

/**
 * Query and return results as an Arrow Table (zero-copy from Rust).
 * This is the fastest path for large datasets.
 * @param sql - The SQL query to execute
 * @returns Arrow Table with typed columns
 */
export const queryArrow = (sql: string): Table => {
  const buffer = window.ultralogi.query(sql);
  if (buffer.length === 0) {
    return new Table();
  }
  return tableFromIPC(buffer);
};

/**
 * Query and convert results to plain JavaScript objects.
 * Use queryArrow() for better performance with large datasets.
 * @param sql - The SQL query to execute
 * @returns Array of row objects
 */
export const queryRows = <T extends Record<string, unknown> = Record<string, unknown>>(sql: string): T[] => {
  const table = queryArrow(sql);
  return table.toArray() as T[];
};

/**
 * Execute a SQL statement (INSERT, UPDATE, DELETE, CREATE, etc.)
 * @param sql - The SQL statement to execute
 * @returns Number of rows affected
 */
export const execute = (sql: string): number => {
  return window.ultralogi.execute(sql);
};
