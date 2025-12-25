/// <reference path="./types/interface.d.ts" />
import { 
  hello, 
  execute, 
  query,
  explainQuery,
  queryTilesGpuReady, 
  benchmarkTileQuery,
  precomputeTileGpuData,
  queryPrecomputedTiles,
  benchmarkPrecomputedQuery,
  // NEW: Raw data export for GPU compute
  exportRawTileData,
  cacheRawTileData,
  getCachedRawTiles,
  benchmarkRawExport,
  benchmarkCachedRaw,
  benchmarkArrowVsNative,
  benchmarkDuckdbSettings,
  // Storage/compression inspection
  getStorageInfo,
  benchmarkCompression,
} from 'ultralogi-rs';

window.ultralogi = {
  hello,
  execute,
  query,
  explainQuery,
  queryTilesGpuReady,
  benchmarkTileQuery,
  precomputeTileGpuData,
  queryPrecomputedTiles,
  benchmarkPrecomputedQuery,
  // NEW: Raw data export for GPU compute
  exportRawTileData,
  cacheRawTileData,
  getCachedRawTiles,
  benchmarkRawExport,
  benchmarkCachedRaw,
  benchmarkArrowVsNative,
  benchmarkDuckdbSettings,
  // Storage/compression inspection
  getStorageInfo,
  benchmarkCompression,
};