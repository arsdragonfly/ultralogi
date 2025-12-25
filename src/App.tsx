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

const GRID_SIZE = 384; // Testing larger grid for 60fps limit estimation

// GPU-ready tile data - pre-computed positions and colors from Rust
interface GpuTileData {
  count: number;
  positions: Float32Array; // vec4[] - x,y,z,w
  colors: Float32Array;    // vec4[] - r,g,b,a
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

export const App: LC = hot(() => {
  const root = document.querySelector("#use-gpu")!;
  const inner = document.querySelector("#use-gpu .canvas")!;
  const [tiles, setTiles] = useState<GpuTileData | null>(null);
  const [queryTime, setQueryTime] = useState<number>(0);
  const [benchmark, setBenchmark] = useState<Record<string, unknown> | null>(null);

  useResource(() => {
    try {
      // Setup the tiles table
      window.ultralogi.execute(`
        CREATE TABLE IF NOT EXISTS tiles (
          x INTEGER,
          y INTEGER,
          tile_type INTEGER,
          elevation FLOAT
        )
      `);
      window.ultralogi.execute("DELETE FROM tiles");
      window.ultralogi.execute(`
        INSERT INTO tiles
        SELECT 
          (i % ${GRID_SIZE}) as x,
          (i / ${GRID_SIZE}) as y,
          (random() * 6)::INTEGER as tile_type,
          sin(i * 0.01) * 30 + random() * 10 as elevation
        FROM range(0, ${GRID_SIZE} * ${GRID_SIZE}) t(i)
      `);
      
      // Run benchmark first (5 iterations for warm cache)
      const benchResults: Array<Record<string, unknown>> = [];
      for (let i = 0; i < 5; i++) {
        const json = window.ultralogi.benchmarkTileQuery(1.0, 1.0);
        benchResults.push(JSON.parse(json));
      }
      // Use the last result (warmed up)
      const benchResult = benchResults[benchResults.length - 1];
      setBenchmark(benchResult);
      console.log("🔬 Benchmark (5th run, µs):", JSON.stringify(benchResult, null, 2));
      
      // Query tiles with GPU-ready format - positions/colors computed in Rust!
      const start = performance.now();
      const buffer = window.ultralogi.queryTilesGpuReady(1.0, 1.0);
      const tileData = parseGpuTileBuffer(buffer);
      const elapsed = performance.now() - start;
      setQueryTime(elapsed);
      setTiles(tileData);
      
      console.log(`Loaded ${tileData.count} tiles in ${elapsed.toFixed(2)}ms (Rust computed!)`);
    } catch (e) {
      console.error("Failed to load tiles:", e);
    }
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
                {/* Render the 3D tile map */}
                {tiles && <TileMap3D tiles={tiles} />}

                {/* Lighting */}
                <AmbientLight intensity={0.4} />
                <PointLight position={[50, 100, 50]} intensity={0.8} />
                
                {/* UI overlay */}
                <UI>
                  <Layout>
                    <Flex direction="y" gap={10} align="start">
                      <Flex
                        width={320}
                        height={80}
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
                              ? `${tiles.count} tiles | Rust→GPU: ${queryTime.toFixed(2)}ms`
                              : "Loading..."}
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
