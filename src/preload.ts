/// <reference path="./types/interface.d.ts" />
import { ipcRenderer } from 'electron';
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
  // Raw data export for GPU compute
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
  // 3D Voxel system
  createVoxelWorld,
  queryVoxelChunk,
  queryVoxelChunkRaw,
  benchmarkVoxelQuery,
} from 'ultralogi-rs';

window.api = {
  hello,
  execute,
  query,
  explainQuery,
  queryTilesGpuReady,
  benchmarkTileQuery,
  precomputeTileGpuData,
  queryPrecomputedTiles,
  benchmarkPrecomputedQuery,
  // Raw data export for GPU compute
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
  // 3D Voxel system
  createVoxelWorld,
  queryVoxelChunk,
  queryVoxelChunkRaw,
  benchmarkVoxelQuery,
  // Screenshot via IPC
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot-fixed'),
};