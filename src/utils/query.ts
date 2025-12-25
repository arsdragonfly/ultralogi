import type { QueryResult } from "ultralogi-rs";

/**
 * Execute a SQL query and parse the results as JSON.
 * @param sql - The SQL query to execute
 * @returns Parsed array of results
 * @throws Error if the query fails
 */
export const queryJson = <T = unknown>(sql: string): T[] => {
  const result: QueryResult = window.ultralogi.execute_sql(sql);
  if (!result.success) {
    throw new Error(result.message);
  }
  if (!result.data) {
    return [];
  }
  return JSON.parse(result.data) as T[];
};
