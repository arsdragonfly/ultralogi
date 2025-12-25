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
} = addon;
