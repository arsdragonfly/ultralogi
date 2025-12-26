/**
 * TRUE GPU Mesh Instancing with per-instance colors
 * 
 * - 36 vertices per cube (unit mesh)
 * - N instances with per-instance offsets AND colors
 * - Hardware instancing: single draw call
 * - Custom WGSL shader applies per-instance transforms and colors
 */

import React from "@use-gpu/live";
import { type LC, useMemo } from "@use-gpu/live";
import { RawData, useSource, useShader } from "@use-gpu/workbench";
// @ts-ignore
import { RawFaces } from "@use-gpu/workbench";
import type { ShaderSource, ShaderModule } from "@use-gpu/shader";
import { bindEntryPoint } from "@use-gpu/shader/wgsl";

// @ts-ignore
import instanceTransformShader from "../shaders/instance-transform.wgsl";

const H = 0.5;

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

const CUBE_TRIS: number[][] = [
  C.LTF, C.LTB, C.RTB,  C.LTF, C.RTB, C.RTF,
  C.LBF, C.RBF, C.RBB,  C.LBF, C.RBB, C.LBB,
  C.LBF, C.LTF, C.RTF,  C.LBF, C.RTF, C.RBF,
  C.RBB, C.RTB, C.LTB,  C.RBB, C.LTB, C.LBB,
  C.RBF, C.RTF, C.RTB,  C.RBF, C.RTB, C.RBB,
  C.LBB, C.LTB, C.LTF,  C.LBB, C.LTF, C.LBF,
];

const BLOCK_COLORS: Record<number, [number, number, number, number]> = {
  1: [0.2, 0.8, 0.2, 1.0],  // grass - green
  2: [0.6, 0.4, 0.2, 1.0],  // dirt - brown
  3: [0.5, 0.5, 0.5, 1.0],  // stone - gray
};
const DEFAULT_COLOR: [number, number, number, number] = [1.0, 0.0, 1.0, 1.0];

function generateCubeMesh(): Float32Array {
  const positions = new Float32Array(36 * 4);
  for (let i = 0; i < 36; i++) {
    const corner = CUBE_TRIS[i];
    positions[i * 4 + 0] = corner[0];
    positions[i * 4 + 1] = corner[1];
    positions[i * 4 + 2] = corner[2];
    positions[i * 4 + 3] = 1.0;
  }
  return positions;
}

// Placeholder colors for mesh (overridden by per-instance colors)
function generateMeshColors(): Float32Array {
  const colors = new Float32Array(36 * 4);
  for (let i = 0; i < 36; i++) {
    colors[i * 4 + 0] = 1.0;
    colors[i * 4 + 1] = 1.0;
    colors[i * 4 + 2] = 1.0;
    colors[i * 4 + 3] = 1.0;
  }
  return colors;
}

function generateInstanceOffsets(
  xData: Uint8Array,
  yData: Uint8Array,
  zData: Uint8Array
): Float32Array {
  const count = xData.length;
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4 + 0] = xData[i] + 0.5;
    data[i * 4 + 1] = yData[i] + 0.5;
    data[i * 4 + 2] = zData[i] + 0.5;
    data[i * 4 + 3] = 0.0;
  }
  return data;
}

function generateInstanceColors(typeData: Uint8Array): Float32Array {
  const count = typeData.length;
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const color = BLOCK_COLORS[typeData[i]] || DEFAULT_COLOR;
    data[i * 4 + 0] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = color[3];
  }
  return data;
}

const OFFSET_ATTR = { format: 'vec4<f32>' as const, name: 'getInstanceOffset' };
const COLOR_ATTR = { format: 'vec4<f32>' as const, name: 'getInstanceColor' };

interface VoxelRendererGPUProps {
  xData: Uint8Array;
  yData: Uint8Array;
  zData: Uint8Array;
  typeData: Uint8Array;
}

const RendererInstanced: LC<{
  meshPositions: ShaderSource;
  meshColors: ShaderSource;
  instanceOffsets: ShaderSource;
  instanceColors: ShaderSource;
  instanceCount: number;
}> = ({ meshPositions, meshColors, instanceOffsets, instanceColors, instanceCount }) => {
  const offsetModule = useSource(OFFSET_ATTR, instanceOffsets);
  const colorModule = useSource(COLOR_ATTR, instanceColors);
  const linkedShader = useShader(instanceTransformShader, [offsetModule, colorModule]);
  
  const loadInstanceShader = useMemo(
    () => bindEntryPoint(linkedShader, 'loadInstance'),
    [linkedShader]
  );
  const transformPositionShader = useMemo(
    () => bindEntryPoint(linkedShader, 'transformPosition'),
    [linkedShader]
  );
  const transformDifferentialShader = useMemo(
    () => bindEntryPoint(linkedShader, 'transformDifferential'),
    [linkedShader]
  );
  const instanceColorShader = useMemo(
    () => bindEntryPoint(linkedShader, 'getColor'),
    [linkedShader]
  );
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transformObj = useMemo(() => ({
    key: 0,
    transform: transformPositionShader,
    differential: transformDifferentialShader,
    bounds: null,
  } as any), [transformPositionShader, transformDifferentialShader]);
  
  console.log(`[GPU INSTANCING] ${instanceCount} instances × 36 verts = ${instanceCount * 36} GPU vertices`);
  
  return (
    <RawFaces
      positions={meshPositions}
      colors={instanceColorShader}
      instances={loadInstanceShader}
      instance={instanceCount}
      transform={transformObj}
      shaded={false}
      side="front"
      depthTest
      depthWrite
    />
  );
};

export const VoxelRendererGPU: LC<VoxelRendererGPUProps> = ({
  xData,
  yData,
  zData,
  typeData,
}) => {
  const meshPositions = useMemo(() => generateCubeMesh(), []);
  const meshColors = useMemo(() => generateMeshColors(), []);
  
  const instanceOffsets = useMemo(
    () => generateInstanceOffsets(xData, yData, zData),
    [xData, yData, zData]
  );
  
  const instanceColors = useMemo(
    () => generateInstanceColors(typeData),
    [typeData]
  );
  
  const instanceCount = xData.length;
  
  return (
    <RawData format="vec4<f32>" data={meshPositions}>
      {(meshPosSource) => (
        <RawData format="vec4<f32>" data={meshColors}>
          {(meshColorSource) => (
            <RawData format="vec4<f32>" data={instanceOffsets}>
              {(offsetSource) => (
                <RawData format="vec4<f32>" data={instanceColors}>
                  {(colorSource) => (
                    <RendererInstanced
                      meshPositions={Array.isArray(meshPosSource) ? meshPosSource[0] : meshPosSource as unknown as ShaderSource}
                      meshColors={Array.isArray(meshColorSource) ? meshColorSource[0] : meshColorSource as unknown as ShaderSource}
                      instanceOffsets={Array.isArray(offsetSource) ? offsetSource[0] : offsetSource as unknown as ShaderSource}
                      instanceColors={Array.isArray(colorSource) ? colorSource[0] : colorSource as unknown as ShaderSource}
                      instanceCount={instanceCount}
                    />
                  )}
                </RawData>
              )}
            </RawData>
          )}
        </RawData>
      )}
    </RawData>
  );
};

export default VoxelRendererGPU;
