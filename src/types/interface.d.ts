declare global {
  interface Window {
    ultralogi: {
      hello(name: string): string;
      execute(sql: string): number;
      query(sql: string): Buffer;
      /** Explain a query and return the query plan */
      explainQuery(sql: string): string;
      /** Query tiles and return GPU-ready Float32 buffer: [count:u32][positions vec4[]][colors vec4[]] */
      queryTilesGpuReady(tileSpacing: number, colorScale: number): Buffer;
      /** Benchmark each step of tile query pipeline, returns JSON with timing in microseconds */
      benchmarkTileQuery(tileSpacing: number, colorScale: number): string;
      /** Precompute GPU-ready tile data and store in cache. Returns time in ms. */
      precomputeTileGpuData(tileSpacing: number, colorScale: number): number;
      /** Query precomputed GPU data - just reads a BLOB, O(1) transform! */
      queryPrecomputedTiles(): Buffer;
      /** Benchmark precomputed query path */
      benchmarkPrecomputedQuery(): string;
      
      // === NEW: Raw data export for GPU compute ===
      /** Export raw tile columns for GPU compute: [count:u32][x:i32...][y:i32...][type:i32...][elev:f32...] */
      exportRawTileData(): Buffer;
      /** Cache raw tile data in Rust memory. Returns time in ms. */
      cacheRawTileData(): number;
      /** Get cached raw tile data (fast clone path) */
      getCachedRawTiles(): Buffer;
      /** Benchmark raw export (no CPU transform) */
      benchmarkRawExport(): string;
      /** Benchmark cached raw export */
      benchmarkCachedRaw(): string;
      /** Benchmark Arrow vs Native to isolate Arrow overhead */
      benchmarkArrowVsNative(): string;
      /** Benchmark different DuckDB settings for Arrow export performance */
      benchmarkDuckdbSettings(): string;
      /** Get storage info showing compression used for tiles table */
      getStorageInfo(): string;
      /** Benchmark compressed vs uncompressed storage */
      benchmarkCompression(): string;
    }
  }
}

export {};