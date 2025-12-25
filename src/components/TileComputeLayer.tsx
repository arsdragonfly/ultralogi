/**
 * GPU-accelerated tile rendering with struct-of-arrays (SoA) input.
 * Uses Use.GPU's WGSL linker to bind multiple data sources to shader functions.
 * 
 * Pipeline: DuckDB → Rust (SoA export) → GPU shaders → WebGPU render
 */

import React from "react";
import { type LC } from "@use-gpu/live";
import { RawData, DataShader, SurfaceLayer } from "@use-gpu/workbench";
import { wgsl } from "@use-gpu/shader/wgsl";
import type { LambdaSource, StorageSource } from "@use-gpu/core";
import type { ShaderSource } from "@use-gpu/shader";

interface TileComputeLayerProps {
  xData: Int32Array;
  yData: Int32Array;
  typeData: Int32Array;
  elevData: Float32Array;
  gridSize: [number, number];
}

/**
 * Position shader: transforms (x, y, elevation) → vec4 position
 * 
 * Use.GPU linker binds sources in declaration order:
 * - getData    → source prop (xData)
 * - getElevData → sources[0] (elevData)  
 * - getYData    → sources[1] (yData)
 */
const positionShader = wgsl`
  @link fn getData(i: u32) -> i32;
  @link fn getElevData(i: u32) -> f32;
  @link fn getYData(i: u32) -> i32;

  @export fn main(i: u32) -> vec4<f32> {
    let x = f32(getData(i));
    let y = f32(getYData(i));
    let z = getElevData(i);
    return vec4<f32>(x, y, z, 1.0);
  }
`;

/**
 * Color shader: maps tile type → RGBA color
 */
const colorShader = wgsl`
  @link fn getData(i: u32) -> i32;

  @export fn main(i: u32) -> vec4<f32> {
    let t = getData(i);
    var r: f32; var g: f32; var b: f32;
    
    if (t == 0) { r = 0.2; g = 0.5; b = 0.8; }       // water
    else if (t == 1) { r = 0.3; g = 0.7; b = 0.3; }  // grass
    else if (t == 2) { r = 0.6; g = 0.6; b = 0.5; }  // rock
    else if (t == 3) { r = 0.9; g = 0.9; b = 0.95; } // snow
    else if (t == 4) { r = 0.8; g = 0.7; b = 0.4; }  // sand
    else if (t == 5) { r = 0.1; g = 0.4; b = 0.1; }  // forest
    else { r = 0.5; g = 0.5; b = 0.5; }
    
    return vec4<f32>(r, g, b, 1.0);
  }
`;

/**
 * GPU-accelerated tile layer using Use.GPU's WGSL linker.
 * 
 * Input: 4 TypedArrays (16MB total for 1M tiles)
 * Transform: GPU shaders link raw data → positions/colors
 * Output: Rendered surface via SurfaceLayer
 */
export const TileComputeLayer: LC<TileComputeLayerProps> = ({
  xData,
  yData,
  typeData,
  elevData,
  gridSize,
}) => (
  <RawData format="i32" data={xData}>
    {(xSource) => (
      <RawData format="i32" data={yData}>
        {(ySource) => (
          <RawData format="f32" data={elevData}>
            {(elevSource) => (
              <RawData format="i32" data={typeData}>
                {(typeSource) => (
                  <DataShader
                    source={xSource as unknown as StorageSource}
                    sources={[elevSource, ySource] as unknown as ShaderSource[]}
                    shader={positionShader}
                  >
                    {(positions: LambdaSource) => (
                      <DataShader
                        source={typeSource as unknown as StorageSource}
                        shader={colorShader}
                      >
                        {(colors: LambdaSource) => (
                          <SurfaceLayer
                            positions={positions}
                            colors={colors}
                            size={gridSize}
                            shaded
                            side="both"
                          />
                        )}
                      </DataShader>
                    )}
                  </DataShader>
                )}
              </RawData>
            )}
          </RawData>
        )}
      </RawData>
    )}
  </RawData>
);

export default TileComputeLayer;
