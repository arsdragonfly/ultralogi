declare global {
  interface Window {
    ultralogi: {
      hello(name: string): string;
      execute(sql: string): number;
      query(sql: string): Buffer;
    }
  }
}

export {};
