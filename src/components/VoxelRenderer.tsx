/**
 * Voxel Renderer - CPU vertex expansion
 * 
 * Generates all vertices on CPU, uploads once to GPU.
 * Single draw call renders all voxels efficiently.
 * 
 * For true GPU mesh instancing with Use.GPU, would need custom
 * vertex shader that applies per-instance transforms. The instances
 * prop only handles draw call repetition, not per-instance transforms.
 */

import React from "@use-gpu/live";
import { type LC, useMemo } from "@use-gpu/live";
import { RawData } from "@use-gpu/workbench";
// @ts-ignore
import { RawFaces } from "@use-gpu/workbench";
import type { ShaderSource } from "@use-gpu/shader";

interface VoxelRendererProps {
  xData: Uint8Array;
  yData: Uint8Array;
  zData: Uint8Array;
  typeData: Uint8Array;
}

const H = 0.5;

// 8 corners of unit cube
const C = {
  LBB: [-H, -H, -H],
  RBB: [+H, -H, -H],
  RTB: [+H, +H, -H],
  LTB: [-H, +H, -H],
  LBF: [-H, -H, +H],
  RBF: [+H, -H, +H],
  RTF: [+H, +H, +H],
  LTF: [-H, +H, +H],
};

// 36 vertices with CCW winding from outside
const CUBE_TRIS: number[][] = [
  C.LTF, C.LTB, C.RTB,  C.LTF, C.RTB, C.RTF,  // TOP
  C.LBF, C.RBF, C.RBB,  C.LBF, C.RBB, C.LBB,  // BOTTOM
  C.LBF, C.LTF, C.RTF,  C.LBF, C.RTF, C.RBF,  // FRONT
  C.RBB, C.RTB, C.LTB,  C.RBB, C.LTB, C.LBB,  // BACK
  C.RBF, C.RTF, C.RTB,  C.RBF, C.RTB, C.RBB,  // RIGHT
  C.LBB, C.LTB, C.LTF,  C.LBB, C.LTF, C.LBF,  // LEFT
];

const BLOCK_COLORS: Record<number, [number, number, number, number]> = {
  1: [0.2, 0.8, 0.2, 1.0],  // grass - green
  2: [0.6, 0.4, 0.2, 1.0],  // dirt - brown
  3: [0.5, 0.5, 0.5, 1.0],  // stone - gray
};
const DEFAULT_COLOR: [number, number, number, number] = [1.0, 0.0, 1.0, 1.0];

function generateAllVertices(
  xData: Uint8Array,
  yData: Uint8Array,
  zData: Uint8Array,
  typeData: Uint8Array
): { positions: Float32Array; colors: Float32Array } {
  const voxelCount = xData.length;
  const vertexCount = voxelCount * 36;
  
  const positions = new Float32Array(vertexCount * 4);
  const colors = new Float32Array(vertexCount * 4);
  
  for (let v = 0; v < voxelCount; v++) {
    const cx = xData[v] + 0.5;
    const cy = yData[v] + 0.5;
    const cz = zData[v] + 0.5;
    const color = BLOCK_COLORS[typeData[v]] || DEFAULT_COLOR;
    
    for (let i = 0; i < 36; i++) {
      const corner = CUBE_TRIS[i];
      const vi = (v * 36 + i) * 4;
      
      positions[vi] = corner[0] + cx;
      positions[vi + 1] = corner[1] + cy;
      positions[vi + 2] = corner[2] + cz;
      positions[vi + 3] = 1.0;
      
      colors[vi] = color[0];
      colors[vi + 1] = color[1];
      colors[vi + 2] = color[2];
      colors[vi + 3] = color[3];
    }
  }
  
  console.log(`[VoxelRenderer] Generated ${vertexCount} vertices for ${voxelCount} voxels`);
  return { positions, colors };
}

const Renderer: LC<{
  posSource: ShaderSource;
  colorSource: ShaderSource;
}> = ({ posSource, colorSource }) => (
  <RawFaces
    positions={posSource}
    colors={colorSource}
    shaded={false}
    side="front"
    depthTest
    depthWrite
  />
);

export const VoxelRenderer: LC<VoxelRendererProps> = ({
  xData,
  yData,
  zData,
  typeData,
}) => {
  const { positions, colors } = useMemo(
    () => generateAllVertices(xData, yData, zData, typeData),
    [xData, yData, zData, typeData]
  );

  return (
    <RawData format="vec4<f32>" data={positions}>
      {(posSource) => (
        <RawData format="vec4<f32>" data={colors}>
          {(colorSource) => (
            <Renderer
              posSource={Array.isArray(posSource) ? posSource[0] : posSource as unknown as ShaderSource}
              colorSource={Array.isArray(colorSource) ? colorSource[0] : colorSource as unknown as ShaderSource}
            />
          )}
        </RawData>
      )}
    </RawData>
  );
};

export default VoxelRenderer;
