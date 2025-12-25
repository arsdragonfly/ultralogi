/// <reference path="./types/interface.d.ts" />
import React, { type LC, type PropsWithChildren, hot, useResource, useState } from "@use-gpu/live";
import { makeFallback } from "./Fallback";
import { HTML } from "@use-gpu/react";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import { PanControls } from "@use-gpu/interact";
import {
  DebugProvider,
  FontLoader,
  FlatCamera,
  Pass,
} from "@use-gpu/workbench";
import { UI, Layout, Flex, Inline, Text } from "@use-gpu/layout";

import { UseInspect } from "@use-gpu/inspect";
import { inspectGPU } from "@use-gpu/inspect-gpu";
import '@use-gpu/inspect/theme.css';

// Benchmark results
type BenchmarkResult = {
  setupMs: number;
  queryMs: number;
  bytesPerQuery: number;
};

// Generate map chunk data in DuckDB
const setupMapData = (chunkSize: number): void => {
  window.ultralogi.execute(`
    CREATE TABLE IF NOT EXISTS map_tiles (
      x INTEGER,
      y INTEGER,
      tile_type INTEGER,
      elevation FLOAT
    )
  `);
  window.ultralogi.execute("DELETE FROM map_tiles");
  window.ultralogi.execute(`
    INSERT INTO map_tiles
    SELECT 
      (i % ${chunkSize}) as x,
      (i / ${chunkSize}) as y,
      (random() * 4)::INTEGER as tile_type,
      sin(i * 0.01) * 50 + random() * 10 as elevation
    FROM range(0, ${chunkSize * chunkSize}) t(i)
  `);
};

// Run benchmark - measures DuckDB query + Arrow IPC serialization + napi-rs transfer
const runBenchmark = (chunkSize: number, iterations: number): BenchmarkResult => {
  const setupStart = performance.now();
  setupMapData(chunkSize);
  const setupMs = performance.now() - setupStart;
  
  // Warm up
  window.ultralogi.query("SELECT * FROM map_tiles WHERE x < 10 AND y < 10");
  
  let totalQueryMs = 0;
  let bytesPerQuery = 0;
  
  for (let i = 0; i < iterations; i++) {
    const startX = Math.floor(Math.random() * (chunkSize - 32));
    const startY = Math.floor(Math.random() * (chunkSize - 32));
    
    const queryStart = performance.now();
    const buffer = window.ultralogi.query(`
      SELECT x, y, tile_type, elevation 
      FROM map_tiles 
      WHERE x >= ${startX} AND x < ${startX + 32}
        AND y >= ${startY} AND y < ${startY + 32}
    `);
    totalQueryMs += performance.now() - queryStart;
    bytesPerQuery = buffer.length;
  }
  
  return {
    setupMs,
    queryMs: totalQueryMs / iterations,
    bytesPerQuery,
  };
};

// Wrap this in its own component to avoid JSX trashing of the view
type CameraProps = PropsWithChildren<object>;
const Camera: LC<CameraProps> = (props: CameraProps) => (
  <PanControls>
    {(x, y, zoom) => (
      <FlatCamera x={x} y={y} zoom={zoom}>
        {props.children}
      </FlatCamera>
    )}
  </PanControls>
);

export const App: LC = hot(() => {
  const root = document.querySelector("#use-gpu")!;
  const inner = document.querySelector("#use-gpu .canvas")!;
  const [greeting, setGreeting] = useState<string>("…");
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(null);

  useResource(() => {
    const msg = window.ultralogi?.hello("Use.GPU");
    if (msg) setGreeting(msg);
    
    try {
      const result = runBenchmark(128, 100);
      setBenchmark(result);
    } catch (e) {
      console.error("Benchmark failed:", e);
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
            <Camera>
              <Pass>
                <UI>
                  <Layout>
                    <Flex width="100%" height="100%" align="center">
                      <Flex
                        width={500}
                        height={150}
                        fill="#1a1a2e"
                        align="center"
                        direction="y"
                      >
                        <Inline align="center">
                          <Text
                            weight="black"
                            size={48}
                            lineHeight={64}
                            color="#4fc3f7"
                          >
                            🚂 Ultralogi
                          </Text>
                        </Inline>
                        <Inline align="center">
                          <Text
                            weight="black"
                            size={16}
                            lineHeight={64}
                            color="#ffffff"
                            opacity={0.5}
                          >
                            {greeting}
                          </Text>
                        </Inline>
                        {benchmark && (
                          <>
                            <Inline align="center">
                              <Text weight="bold" size={14} lineHeight={20} color="#ffb74d">
                                📊 Benchmark: 32x32 chunk query (100 iterations)
                              </Text>
                            </Inline>
                            <Inline align="center">
                              <Text weight="normal" size={12} lineHeight={18} color="#ffffff">
                                Query+IPC: {benchmark.queryMs.toFixed(2)}ms | {(1000 / benchmark.queryMs).toFixed(0)} queries/sec
                              </Text>
                            </Inline>
                            <Inline align="center">
                              <Text weight="normal" size={11} lineHeight={16} color="#aaaaaa">
                                ~1024 tiles | {(benchmark.bytesPerQuery / 1024).toFixed(1)} KB/query
                              </Text>
                            </Inline>
                          </>
                        )}
                      </Flex>
                    </Flex>
                  </Layout>
                </UI>
              </Pass>
            </Camera>
          </FontLoader>
        </AutoCanvas>
      </WebGPU>
    </UseInspect>
  );
}, import.meta);
