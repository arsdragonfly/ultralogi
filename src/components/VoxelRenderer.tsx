/**
 * Minimal 3D Voxel Renderer - Cube Faces
 * 
 * Pipeline: DuckDB → Raw u8 arrays → Expand to cube faces → GPU → FaceLayer
 * 
 * Each voxel becomes 6 faces (36 vertices with indices, 12 triangles).
 * We only render top faces for now to reduce complexity.
 */

import React from "@use-gpu/live";
import { type LC, useMemo } from "@use-gpu/live";
import { 
  RawData, 
  FaceLayer,
} from "@use-gpu/workbench";
import type { ShaderSource } from "@use-gpu/shader";

interface VoxelRendererProps {
  /** X positions (u8) - right (0-31) */
  xData: Uint8Array;
  /** Y positions (u8) - up/height (0-63) */  
  yData: Uint8Array;
  /** Z positions (u8) - forward/depth (0-31) */
  zData: Uint8Array;
  /** Block types (u8): 0=air, 1=grass, 2=dirt, 3=stone */
  typeData: Uint8Array;
}

/**
 * Generate cube face vertices for all voxels
 * Returns: positions (Float32Array x,y,z,w per vertex), colors (Float32Array r,g,b,a per vertex)
 * Each cube has 6 faces * 2 triangles * 3 vertices = 36 vertices
 */
function generateCubeFaces(
  xData: Uint8Array,
  yData: Uint8Array, 
  zData: Uint8Array,
  typeData: Uint8Array
): { positions: Float32Array; colors: Float32Array; count: number } {
  const voxelCount = xData.length;
  // 6 faces * 2 triangles * 3 vertices = 36 vertices per cube
  const verticesPerCube = 36;
  const count = voxelCount * verticesPerCube;
  
  const positions = new Float32Array(count * 4); // vec4
  const colors = new Float32Array(count * 4);    // vec4
  
  // Define cube vertices (unit cube centered at 0.5, 0.5, 0.5)
  // So cube at (x,y,z) spans from (x,y,z) to (x+1, y+1, z+1)
  const cubeVertices = [
    // Front face (z+1)
    [0,0,1], [1,0,1], [1,1,1], [0,0,1], [1,1,1], [0,1,1],
    // Back face (z=0)
    [1,0,0], [0,0,0], [0,1,0], [1,0,0], [0,1,0], [1,1,0],
    // Top face (y+1)
    [0,1,0], [0,1,1], [1,1,1], [0,1,0], [1,1,1], [1,1,0],
    // Bottom face (y=0)
    [0,0,0], [1,0,0], [1,0,1], [0,0,0], [1,0,1], [0,0,1],
    // Right face (x+1)
    [1,0,0], [1,1,0], [1,1,1], [1,0,0], [1,1,1], [1,0,1],
    // Left face (x=0)
    [0,0,1], [0,1,1], [0,1,0], [0,0,1], [0,1,0], [0,0,0],
  ];
  
  // Color by block type
  const blockColors: Record<number, [number, number, number]> = {
    1: [0.2, 0.8, 0.2],   // grass - green
    2: [0.55, 0.35, 0.15], // dirt - brown  
    3: [0.5, 0.5, 0.5],   // stone - gray
  };
  const defaultColor: [number, number, number] = [1.0, 0.0, 1.0]; // magenta for unknown
  
  for (let i = 0; i < voxelCount; i++) {
    const vx = xData[i];
    const vy = yData[i];
    const vz = zData[i];
    const blockType = typeData[i];
    
    const color = blockColors[blockType] || defaultColor;
    
    const baseIdx = i * verticesPerCube;
    for (let v = 0; v < verticesPerCube; v++) {
      const cv = cubeVertices[v];
      const pidx = (baseIdx + v) * 4;
      positions[pidx]     = vx + cv[0];
      positions[pidx + 1] = vy + cv[1];
      positions[pidx + 2] = vz + cv[2];
      positions[pidx + 3] = 1.0;
      
      colors[pidx]     = color[0];
      colors[pidx + 1] = color[1];
      colors[pidx + 2] = color[2];
      colors[pidx + 3] = 1.0;
    }
  }
  
  return { positions, colors, count };
}

/**
 * Voxel renderer using cube faces (FaceLayer with triangles).
 */
export const VoxelRenderer: LC<VoxelRendererProps> = ({
  xData,
  yData,
  zData,
  typeData,
}) => {
  const voxelCount = xData.length;
  
  // Generate cube face geometry on CPU
  const { positions, colors, count } = useMemo(() => {
    console.log(`🎨 VoxelRenderer: Generating ${voxelCount} cubes (${voxelCount * 36} vertices)`);
    return generateCubeFaces(xData, yData, zData, typeData);
  }, [xData, yData, zData, typeData, voxelCount]);
  
  // Debug: log first few voxels
  if (voxelCount > 0) {
    console.log(`First 3 voxels: (${xData[0]},${yData[0]},${zData[0]}) type=${typeData[0]}, (${xData[1]},${yData[1]},${zData[1]}) type=${typeData[1]}, (${xData[2]},${yData[2]},${zData[2]}) type=${typeData[2]}`);
  }

  if (count === 0) {
    return null;
  }

  return (
    <RawData format="vec4<f32>" data={positions}>
      {(posSource) => (
        <RawData format="vec4<f32>" data={colors}>
          {(colorSource) => (
            <FaceLayer
              positions={posSource as unknown as ShaderSource}
              colors={colorSource as unknown as ShaderSource}
              count={count}
              shaded={false}
              side="front"
              depthTest
              depthWrite
            />
          )}
        </RawData>
      )}
    </RawData>
  );
};

export default VoxelRenderer;
