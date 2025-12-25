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

import { queryRows } from "./utils/query";

// Wrap this in its own component to avoid JSX trashing of the view
type CameraProps = PropsWithChildren<object>;
const Camera: LC<CameraProps> = (props: CameraProps) => (
  /* 2D pan controls + flat view */
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
  const [sqlResult, setSqlResult] = useState<string>("");

  useResource(() => {
    // Initialize the Rust engine
    const msg = window.ultralogi?.hello("Use.GPU");
    if (msg) setGreeting(msg);
    
    // Test SQL execution with Arrow
    try {
      const rows = queryRows<{ version: string }>("SELECT version() as version");
      if (rows?.[0]) {
        setSqlResult(`DuckDB: ${rows[0].version}`);
      }
    } catch (e) {
      console.error("Failed to query DuckDB:", e);
      setSqlResult("DuckDB query failed");
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
                        width={600}
                        height={200}
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
                            weight="bold"
                            size={18}
                            lineHeight={32}
                            color="#ffffff"
                            opacity={0.8}
                          >
                            {greeting}
                          </Text>
                        </Inline>
                        <Inline align="center">
                          <Text
                            weight="normal"
                            size={14}
                            lineHeight={24}
                            color="#81c784"
                          >
                            {sqlResult}
                          </Text>
                        </Inline>
                        <Inline align="center">
                          <Text
                            weight="normal"
                            size={12}
                            lineHeight={20}
                            color="#888888"
                          >
                            Press Ctrl+Shift+I for DevTools
                          </Text>
                        </Inline>
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
