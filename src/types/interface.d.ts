import type { QueryResult } from "ultralogi-rs";

declare global {
  interface Window {
    ultralogi: {
      hello(name: string): string;
      executeSql(sql: string): QueryResult;
    }
  }
}
