declare global {
  interface Window {
    ultralogi: {
      hello(name: string): string;
      /** Execute a SQL statement (DDL/DML). Returns rows affected. */
      execute(sql: string): number;
      /** Query and return Arrow IPC stream buffer. Use with apache-arrow tableFromIPC(). */
      query(sql: string): Buffer;
    }
  }
}

export {};
