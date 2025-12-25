declare global {
  interface Window {
    ultralogi: {
      hello(name: string): string;
      execute(sql: string): number;
      query(sql: string): Buffer;
      /** Query tiles and return GPU-ready Float32 buffer: [count:u32][positions vec4[]][colors vec4[]] */
      queryTilesGpuReady(tileSpacing: number, colorScale: number): Buffer;
      /** Benchmark each step of tile query pipeline, returns JSON with timing in microseconds */
      benchmarkTileQuery(tileSpacing: number, colorScale: number): string;
    }
  }
}

export {};
