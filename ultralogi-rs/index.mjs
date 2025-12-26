import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const addon = require("./ultralogi-rs.node");

export default addon;
export const { 
  hello,
  execute,
  explainQuery,
  query,
  benchmarkTileQuery,
  queryTilesGpuReady,
  executeWithCache,
  queryTilesCached,
  getCacheStats,
  clearPolarsCache,
  benchmarkPolarsCache,
  precomputeTileGpuData,
  queryPrecomputedTiles,
  benchmarkPrecomputedQuery,
  exportRawTileData,
  benchmarkArrowVsNative,
  benchmarkDuckdbSettings,
  getStorageInfo,
  benchmarkCompression,
  cacheRawTileData,
  getCachedRawTiles,
  benchmarkRawExport,
  benchmarkCachedRaw,
  generateTileChunks,
  queryChunkedTiles,
  benchmarkChunkedQuery,
  createVoxelWorld,
  queryVoxelChunk,
  queryVoxelChunkRaw,
  benchmarkVoxelQuery,
} = addon;
