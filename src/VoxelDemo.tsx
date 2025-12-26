/// <reference path="./types/interface.d.ts" />
import React, { type LC, type PropsWithChildren, hot, useResource, useState } from "@use-gpu/live";
import { makeFallback } from "./Fallback";
import { HTML } from "@use-gpu/react";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import { OrbitControls } from "@use-gpu/interact";
import {
  DebugProvider,
  FontLoader,
  OrbitCamera,
  Pass,
  PointLight,
  AmbientLight,
} from "@use-gpu/workbench";
import type { VectorLike } from "@use-gpu/core";
import { UseInspect } from "@use-gpu/inspect";
import { inspectGPU } from "@use-gpu/inspect-gpu";
import '@use-gpu/inspect/theme.css';
import { VoxelRenderer } from "./components/VoxelRenderer";

// Voxel data parsed from Rust raw buffer
interface VoxelData {
  count: number;
  xData: Uint8Array;
  yData: Uint8Array;
  zData: Uint8Array;
  typeData: Uint8Array;
}

// Parse raw buffer: [count:u32][x:u8[]][y:u8[]][z:u8[]][type:u8[]]
function parseVoxelBuffer(buffer: Buffer): VoxelData {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const count = view.getUint32(0, true);
  
  const x = new Uint8Array(buffer.buffer, buffer.byteOffset + 4, count);
  const y = new Uint8Array(buffer.buffer, buffer.byteOffset + 4 + count, count);
  const z = new Uint8Array(buffer.buffer, buffer.byteOffset + 4 + count * 2, count);
  const t = new Uint8Array(buffer.buffer, buffer.byteOffset + 4 + count * 3, count);
  
  return { count, xData: x, yData: y, zData: z, typeData: t };
}

// 3D Camera - Full voxel world
type CameraProps = PropsWithChildren<object>;
const Camera3D: LC<CameraProps> = (props: CameraProps) => (
  <OrbitControls
    radius={80}
    bearing={Math.PI / 4}
    pitch={Math.PI / 5}
    target={[16, 16, 16]}
  >
    {(radius, phi, theta, target) => (
      <OrbitCamera 
        radius={radius} 
        phi={phi} 
        theta={theta}
        target={target as unknown as VectorLike}
        fov={Math.PI / 3}
        near={0.1}
        far={300}
      >
        {props.children}
      </OrbitCamera>
    )}
  </OrbitControls>
);

/**
 * 3D Voxel Demo - DuckDB → Arrow → WebGPU
 */
export const VoxelDemo: LC = hot(() => {
  const root = document.querySelector("#use-gpu")!;
  const inner = document.querySelector("#use-gpu .canvas")!;
  const [voxels, setVoxels] = useState<VoxelData | null>(null);

  // Load voxel world on mount
  useResource(async () => {
    if (!window.api) {
      console.error("Error: window.api not available");
      return;
    }

    try {
      console.log("🌍 Creating voxel world...");
      
      // Create voxel world (chunk 0,0)
      const createResult = await window.api.createVoxelWorld(0, 0);
      console.log("Created world:", JSON.stringify(createResult));
      
      // Query non-air voxels for rendering
      const start = performance.now();
      const rawBuffer = await window.api.queryVoxelChunkRaw(0, 0);
      const queryTime = performance.now() - start;
      
      const parsed = parseVoxelBuffer(rawBuffer);
      console.log(`✅ Loaded ${parsed.count} voxels, query took ${queryTime.toFixed(1)}ms`);
      
      // Debug: count block types and check Y values for grass
      const typeCounts = [0, 0, 0, 0, 0];
      let grassYMin = 999, grassYMax = -1;
      let stoneYMin = 999, stoneYMax = -1;
      for (let i = 0; i < parsed.typeData.length; i++) {
        const t = parsed.typeData[i];
        const y = parsed.yData[i];
        if (t < 5) typeCounts[t]++;
        if (t === 1) { // grass
          if (y < grassYMin) grassYMin = y;
          if (y > grassYMax) grassYMax = y;
        }
        if (t === 3) { // stone
          if (y < stoneYMin) stoneYMin = y;
          if (y > stoneYMax) stoneYMax = y;
        }
      }
      console.log(`Block types: air=${typeCounts[0]}, grass=${typeCounts[1]}, dirt=${typeCounts[2]}, stone=${typeCounts[3]}`);
      console.log(`🌿 Grass Y range: ${grassYMin}-${grassYMax}, 🪨 Stone Y range: ${stoneYMin}-${stoneYMax}`);
      
      setVoxels(parsed);
      
      // Auto-screenshot after 5 seconds for debugging (more time for GPU render)
      setTimeout(async () => {
        if (window.api?.takeScreenshot) {
          const path = await window.api.takeScreenshot();
          console.log(`📸 Auto-screenshot saved: ${path}`);
        }
      }, 5000);
      
    } catch (err) {
      console.error("Voxel load error:", err);
    }
  }, []);

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
                {voxels && (
                  <VoxelRenderer
                    xData={voxels.xData}
                    yData={voxels.yData}
                    zData={voxels.zData}
                    typeData={voxels.typeData}
                  />
                )}
                
                <AmbientLight intensity={0.4} />
                <PointLight position={[50, 50, 100]} intensity={0.8} />
              </Pass>
            </Camera3D>
          </FontLoader>
        </AutoCanvas>
      </WebGPU>
    </UseInspect>
  );
}, import.meta);
