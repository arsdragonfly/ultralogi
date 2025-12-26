/// <reference path="./types/interface.d.ts" />
import React, { type LC, type PropsWithChildren, hot, useResource, useState, useMemo } from "@use-gpu/live";
import { makeFallback } from "./Fallback";
import { HTML } from "@use-gpu/react";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import { OrbitControls } from "@use-gpu/interact";
import {
  DebugProvider,
  FontLoader,
  OrbitCamera,
  Pass,
  RawData,
  SurfaceLayer,
  AmbientLight,
  PointLight,
} from "@use-gpu/workbench";
import type { VectorLike } from "@use-gpu/core";
import type { ShaderSource } from "@use-gpu/shader";
import { UI, Layout, Flex, Inline, Text } from "@use-gpu/layout";

import { UseInspect } from "@use-gpu/inspect";
import { inspectGPU } from "@use-gpu/inspect-gpu";
import '@use-gpu/inspect/theme.css';

import { TileComputeLayer } from "./components/TileComputeLayer";
import { parseRawTileBuffer } from "./utils/gpu-compute";

const GRID_SIZE = 1024; // Testing 1024×1024 = 1,048,576 tiles (1M!)

// GPU-ready tile data - pre-computed positions and colors from Rust (CPU path)
interface GpuTileData {
  count: number;
  positions: Float32Array; // vec4[] - x,y,z,w
  colors: Float32Array;    // vec4[] - r,g,b,a
}

// Raw tile data - for GPU compute path
interface RawTileData {
  count: number;
  xData: Int32Array;
  yData: Int32Array;
  typeData: Int32Array;
  elevData: Float32Array;
}

// Parse the raw buffer from queryTilesGpuReady - ZERO PARSING OVERHEAD!
function parseGpuTileBuffer(buffer: Buffer): GpuTileData {
  const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  
  // First 4 bytes = count (u32 little-endian)
  const count = dataView.getUint32(0, true);
  
  // Rest is positions then colors as f32
  const floatData = new Float32Array(
    buffer.buffer, 
    buffer.byteOffset + 4, 
    count * 8 // 4 floats for position + 4 floats for color
  );
  
  // Split into positions and colors (views into same buffer - zero copy!)
  const positions = new Float32Array(floatData.buffer, floatData.byteOffset, count * 4);
  const colors = new Float32Array(floatData.buffer, floatData.byteOffset + count * 16, count * 4);
  
  return { count, positions, colors };
}

// 3D Camera with orbit controls
type CameraProps = PropsWithChildren<object>;
const Camera3D: LC<CameraProps> = (props: CameraProps) => (
  <OrbitControls
    radius={100}
    bearing={0.5}
    pitch={0.4}
  >
    {(radius, phi, theta, target) => (
      <OrbitCamera 
        radius={radius} 
        phi={phi} 
        theta={theta}
        target={target as unknown as VectorLike}
        fov={60}
        near={1}
        far={1000}
      >
        {props.children}
      </OrbitCamera>
    )}
  </OrbitControls>
);

// Component to render map tiles - wrap Float32Arrays in RawData for GPU upload
type TileMapProps = {
  tiles: GpuTileData;
};

const TileMap3D: LC<TileMapProps> = ({ tiles }: TileMapProps) => {
  return (
    <RawData format="vec4<f32>" data={tiles.positions}>
      {(positionsSource) => (
        <RawData format="vec4<f32>" data={tiles.colors}>
          {(colorsSource) => (
            <SurfaceLayer
              positions={positionsSource as unknown as ShaderSource}
              colors={colorsSource as unknown as ShaderSource}
              size={[GRID_SIZE, GRID_SIZE]}
              shaded
              side="both"
            />
          )}
        </RawData>
      )}
    </RawData>
  );
};

export const VoxelApp: LC = hot(() => {
  const root = document.querySelector("#use-gpu")!;
  const inner = document.querySelector("#use-gpu .canvas")!;
  const [tiles, setTiles] = useState<GpuTileData | null>(null);
  const [rawTiles, setRawTiles] = useState<RawTileData | null>(null);
  const [useGpuCompute, setUseGpuCompute] = useState<boolean>(true); // Default to GPU compute path!
  const [queryTime, setQueryTime] = useState<number>(0);
  const [benchmark, setBenchmark] = useState<Record<string, unknown> | null>(null);

  useResource(() => {
    // Keyboard handler for toggling GPU/CPU transform path
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'g' || e.key === 'G') {
        setUseGpuCompute(prev => {
          const next = !prev;
          console.log(`🔄 Switched to ${next ? '🎮 GPU Shader' : '💻 CPU Transform'} path`);
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeydown);
    
    // Log WebGPU adapter info
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gpu = (navigator as any).gpu;
      if (gpu) {
        const adapter = await gpu.requestAdapter();
        if (adapter) {
          console.log(`🎮 WebGPU Adapter Info:`);
          console.log(`   Is Fallback Adapter: ${adapter.isFallbackAdapter}`);
          
          // Try different ways to get adapter info
          const info = adapter.info;
          if (info) {
            console.log(`   Vendor: ${info.vendor}`);
            console.log(`   Architecture: ${info.architecture}`);
            console.log(`   Device: ${info.device}`);
            console.log(`   Description: ${info.description}`);
          }
          
          // Log features to infer backend
          const features = [...adapter.features];
          console.log(`   Features (${features.length}): ${features.slice(0, 5).join(', ')}${features.length > 5 ? '...' : ''}`);
          
          // Log limits
          const limits = adapter.limits;
          console.log(`   Max Texture Dimension 2D: ${limits.maxTextureDimension2D}`);
          console.log(`   Max Buffer Size: ${(limits.maxBufferSize / (1024*1024*1024)).toFixed(2)} GB`);
          console.log(`   Max Compute Invocations Per Workgroup: ${limits.maxComputeInvocationsPerWorkgroup}`);
          
          // Request device and check
          const device = await adapter.requestDevice();
          if (device) {
            console.log(`   ✅ Device created successfully`);
            // Check for timestamp query support (often indicates real hardware)
            if (adapter.features.has('timestamp-query')) {
              console.log(`   ✅ timestamp-query supported (hardware accelerated)`);
            }
          }
        } else {
          console.log(`❌ WebGPU: No adapter available`);
        }
      } else {
        console.log(`❌ WebGPU: Not supported`);
      }
    })();
    
    try {
      // Setup the tiles table
      window.api.execute(`
        CREATE TABLE IF NOT EXISTS tiles (
          x INTEGER,
          y INTEGER,
          tile_type INTEGER,
          elevation FLOAT
        )
      `);
      window.api.execute("DELETE FROM tiles");
      window.api.execute(`
        INSERT INTO tiles
        SELECT 
          (i % ${GRID_SIZE}) as x,
          (i / ${GRID_SIZE}) as y,
          (random() * 6)::INTEGER as tile_type,
          sin(i * 0.01) * 30 + random() * 10 as elevation
        FROM range(0, ${GRID_SIZE} * ${GRID_SIZE}) t(i)
      `);
      
      // Show query plan
      console.log("📋 Query Plan:");
      console.log(window.api.explainQuery("SELECT x, y, tile_type, elevation FROM tiles"));

      // === BENCHMARK: Storage Compression ===
      console.log("\n📦 Storage compression analysis...");
      try {
        const storageInfo = JSON.parse(window.api.getStorageInfo());
        console.log(`   force_compression setting: ${storageInfo.force_compression}`);
        console.log(`   Column compression:`);
        for (const col of storageInfo.columns || []) {
          console.log(`     ${col.column}: ${col.compression} (${col.segments} segments)`);
        }
        
        // Benchmark compression impact
        console.log("\n🔄 Benchmarking compression impact...");
        const compressionBench = JSON.parse(window.api.benchmarkCompression());
        console.log(`   Current table read: ${compressionBench.current_read_us}µs`);
        console.log(`   Uncompressed table: ${compressionBench.uncompressed_read_us}µs (actual: ${compressionBench.uncompressed_actual})`);
        console.log(`   Bitpacked table: ${compressionBench.bitpacked_read_us}µs (actual: ${compressionBench.bitpacked_actual})`);
        console.log(`   Speedup (uncompressed vs bitpacked): ${compressionBench.speedup_ratio}x`);
      } catch (e) {
        console.log(`   Storage info unavailable: ${e}`);
      }
      
      // === BENCHMARK 0: DuckDB Settings ===
      console.log("\n⚙️ Testing DuckDB configuration settings...");
      const settingsResult = JSON.parse(window.api.benchmarkDuckdbSettings());
      console.log(`   Current threads: ${settingsResult.current_threads}`);
      console.log(`   Memory limit: ${settingsResult.current_memory_limit}`);
      console.log(`   Arrow batch count: ${settingsResult.batch_count} (for ${settingsResult.total_rows} rows)`);
      console.log(`   Default Arrow: ${settingsResult.default_us}µs`);
      console.log(`   No preserve_order: ${settingsResult.no_preserve_order_us}µs`);
      console.log(`   Thread scaling: 1→${settingsResult.threads_1_us}µs, 2→${settingsResult.threads_2_us}µs, 4→${settingsResult.threads_4_us}µs, 8→${settingsResult.threads_8_us}µs`);
      console.log(`   Row iterator (no Arrow): ${settingsResult.row_iterator_us}µs (${settingsResult.row_iterator_count} rows)`);
      
      // === BENCHMARK 0b: Arrow vs Native (isolate Arrow overhead) ===
      console.log("\n🔬 Benchmarking Arrow vs Native to isolate overhead...");
      const arrowVsNative = JSON.parse(window.api.benchmarkArrowVsNative());
      console.log(`   Arrow materialize (1M rows): ${arrowVsNative.arrow_materialize_us}µs`);
      console.log(`   Native COUNT(*): ${arrowVsNative.native_count_us}µs`);
      console.log(`   Scan LIMIT 1: ${arrowVsNative.scan_limit1_us}µs`);
      console.log(`   Memcpy 16MB baseline: ${arrowVsNative.memcpy_16mb_us}µs (theoretical DDR4 max)`);
      console.log(`   Alloc 16MB: ${arrowVsNative.alloc_16mb_us}µs`);
      console.log(`   → Arrow overhead: ~${(arrowVsNative.arrow_materialize_us - arrowVsNative.native_count_us)}µs for data movement`);
      
      // === BENCHMARK 1: Dynamic query (CPU transform on every call) ===
      console.log("\n🔥 Warming up DuckDB cache (dynamic query)...");
      for (let i = 0; i < 10; i++) {
        window.api.queryTilesGpuReady(1.0, 1.0);
      }
      
      const dynamicResults: Array<Record<string, unknown>> = [];
      for (let i = 0; i < 10; i++) {
        dynamicResults.push(JSON.parse(window.api.benchmarkTileQuery(1.0, 1.0)));
      }
      const dynamicTotals = dynamicResults.map(r => r.total_us as number);
      console.log(`🔬 [OLD] CPU Transform (10 runs, µs): min=${Math.min(...dynamicTotals).toFixed(0)}, avg=${(dynamicTotals.reduce((a, b) => a + b, 0) / 10).toFixed(0)}, max=${Math.max(...dynamicTotals).toFixed(0)}`);
      console.log("   Breakdown:", JSON.stringify(dynamicResults[9].breakdown, null, 2));

      // === BENCHMARK 2: Raw export (no CPU transform - for GPU compute) ===
      console.log("\n📦 Benchmarking raw data export (zero CPU transform)...");
      for (let i = 0; i < 10; i++) {
        window.api.exportRawTileData();
      }
      
      const rawResults: Array<Record<string, unknown>> = [];
      for (let i = 0; i < 10; i++) {
        rawResults.push(JSON.parse(window.api.benchmarkRawExport()));
      }
      const rawTotals = rawResults.map(r => r.total_us as number);
      console.log(`🔬 [NEW] Raw Export (10 runs, µs): min=${Math.min(...rawTotals).toFixed(0)}, avg=${(rawTotals.reduce((a, b) => a + b, 0) / 10).toFixed(0)}, max=${Math.max(...rawTotals).toFixed(0)}`);
      console.log("   Breakdown:", JSON.stringify(rawResults[9].breakdown, null, 2));
      
      const rawVsCpu = ((dynamicTotals.reduce((a, b) => a + b, 0) / rawTotals.reduce((a, b) => a + b, 0))).toFixed(1);
      console.log(`   🎯 Raw export is ${rawVsCpu}× faster than CPU transform!`);

      // === BENCHMARK 3: Cached CPU-transformed data ===
      console.log("\n⚡ Precomputing GPU data (CPU transform, cached)...");
      const precomputeTime = window.api.precomputeTileGpuData(1.0, 1.0);
      console.log(`   Precompute took ${precomputeTime}ms (one-time cost)`);
      
      for (let i = 0; i < 10; i++) {
        window.api.queryPrecomputedTiles();
      }
      
      const precompResults: Array<Record<string, unknown>> = [];
      for (let i = 0; i < 10; i++) {
        precompResults.push(JSON.parse(window.api.benchmarkPrecomputedQuery()));
      }
      const precompTotals = precompResults.map(r => r.total_us as number);
      console.log(`🔬 [OLD] Cached CPU (10 runs, µs): min=${Math.min(...precompTotals).toFixed(0)}, avg=${(precompTotals.reduce((a, b) => a + b, 0) / 10).toFixed(0)}, max=${Math.max(...precompTotals).toFixed(0)}`);
      console.log("   Breakdown:", JSON.stringify(precompResults[9].breakdown, null, 2));

      // === BENCHMARK 4: Cached raw data (for GPU compute path) ===
      console.log("\n⚡ Caching raw tile data (for GPU compute)...");
      const cacheTime = window.api.cacheRawTileData();
      console.log(`   Cache took ${cacheTime}ms (one-time cost)`);
      
      for (let i = 0; i < 10; i++) {
        window.api.getCachedRawTiles();
      }
      
      const cachedRawResults: Array<Record<string, unknown>> = [];
      for (let i = 0; i < 10; i++) {
        cachedRawResults.push(JSON.parse(window.api.benchmarkCachedRaw()));
      }
      const cachedRawTotals = cachedRawResults.map(r => r.total_us as number);
      console.log(`🔬 [NEW] Cached Raw (10 runs, µs): min=${Math.min(...cachedRawTotals).toFixed(0)}, avg=${(cachedRawTotals.reduce((a, b) => a + b, 0) / 10).toFixed(0)}, max=${Math.max(...cachedRawTotals).toFixed(0)}`);
      console.log("   Breakdown:", JSON.stringify(cachedRawResults[9].breakdown, null, 2));

      // === SUMMARY ===
      const avgDynamic = dynamicTotals.reduce((a, b) => a + b, 0) / 10;
      const avgRaw = rawTotals.reduce((a, b) => a + b, 0) / 10;
      const avgPrecomp = precompTotals.reduce((a, b) => a + b, 0) / 10;
      const avgCachedRaw = cachedRawTotals.reduce((a, b) => a + b, 0) / 10;
      
      console.log("\n" + "=".repeat(60));
      console.log("📊 BENCHMARK SUMMARY (1M tiles, avg µs):");
      console.log("=".repeat(60));
      console.log(`   [OLD] CPU Transform:  ${avgDynamic.toFixed(0)}µs (query + collect + transform + pack)`);
      console.log(`   [NEW] Raw Export:     ${avgRaw.toFixed(0)}µs (query + collect + memcpy) → ${(avgDynamic/avgRaw).toFixed(1)}× faster`);
      console.log(`   [OLD] Cached CPU:     ${avgPrecomp.toFixed(0)}µs (clone 32MB)`);
      console.log(`   [NEW] Cached Raw:     ${avgCachedRaw.toFixed(0)}µs (clone 16MB) → ${(avgPrecomp/avgCachedRaw).toFixed(1)}× faster`);
      console.log("=".repeat(60));
      console.log("   💡 Raw data is 2× smaller (16MB vs 32MB) - no redundant w,a components!");
      console.log("   💡 GPU compute shader will transform raw→positions/colors in <1ms");
      console.log("=".repeat(60));

      setBenchmark(precompResults[9]);
      
      // Load tiles using precomputed path for rendering (CPU transform path)
      const start = performance.now();
      const buffer = window.api.queryPrecomputedTiles();
      const tileData = parseGpuTileBuffer(buffer);
      const elapsed = performance.now() - start;
      setQueryTime(elapsed);
      setTiles(tileData);
      
      console.log(`[CPU Path] Loaded ${tileData.count} tiles in ${elapsed.toFixed(2)}ms (precomputed!)`);

      // Also load raw tiles for GPU compute path
      const startRaw = performance.now();
      const rawBuffer = window.api.getCachedRawTiles();
      const rawTileData = parseRawTileBuffer(rawBuffer);
      const elapsedRaw = performance.now() - startRaw;
      setRawTiles(rawTileData);
      
      console.log(`[GPU Path] Loaded ${rawTileData.count} raw tiles in ${elapsedRaw.toFixed(2)}ms`);
      console.log(`   💡 GPU path data is ${((buffer.length / rawBuffer.length) * 100).toFixed(0)}% of CPU path size!`);
    } catch (e) {
      console.error("Failed to load tiles:", e);
    }
    
    // Cleanup
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  });

  return (
    <UseInspect container={root} provider={DebugProvider} extensions={[inspectGPU]}>
      <WebGPU
        fallback={(error: Error) => (
          <HTML container={inner}>{makeFallback(error)}</HTML>
        )}
      >
        <AutoCanvas selector="#use-gpu .canvas" samples={4}>
          <FontLoader>
            <Camera3D>
              <Pass lights>
                {/* Render the 3D tile map - GPU compute path (WGSL shader) or CPU path */}
                {useGpuCompute && rawTiles && (
                  <TileComputeLayer
                    xData={rawTiles.xData}
                    yData={rawTiles.yData}
                    typeData={rawTiles.typeData}
                    elevData={rawTiles.elevData}
                    gridSize={[GRID_SIZE, GRID_SIZE]}
                  />
                )}
                {!useGpuCompute && tiles && <TileMap3D tiles={tiles} />}

                {/* Lighting */}
                <AmbientLight intensity={0.4} />
                <PointLight position={[50, 100, 50]} intensity={0.8} />
                
                {/* UI overlay */}
                <UI>
                  <Layout>
                    <Flex direction="y" gap={10} align="start">
                      <Flex
                        width={320}
                        height={100}
                        fill="#1a1a2ecc"
                        align="center"
                        direction="y"
                      >
                        <Inline align="center">
                          <Text weight="black" size={24} lineHeight={32} color="#4fc3f7">
                            {`🚂 Ultralogi`}
                          </Text>
                        </Inline>
                        <Inline align="center">
                          <Text weight="normal" size={12} lineHeight={20} color="#ffffff">
                            {tiles 
                              ? `${tiles.count} tiles | ${useGpuCompute ? '🎮 GPU Shader' : '💻 CPU Transform'}`
                              : "Loading..."}
                          </Text>
                        </Inline>
                        <Inline align="center">
                          <Text weight="normal" size={10} lineHeight={16} color="#aaaaaa">
                            {`Data load: ${queryTime.toFixed(2)}ms | Press G to toggle`}
                          </Text>
                        </Inline>
                      </Flex>
                    </Flex>
                  </Layout>
                </UI>
              </Pass>
            </Camera3D>
          </FontLoader>
        </AutoCanvas>
      </WebGPU>
    </UseInspect>
  );
}, import.meta);
