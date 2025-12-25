// GPU Compute utilities for tile data transformation
// Uses Use.GPU's native compute infrastructure for better scriptability

export interface RawTileData {
  count: number;
  xData: Int32Array;
  yData: Int32Array;
  typeData: Int32Array;
  elevData: Float32Array;
}

export interface GpuTileBuffers {
  count: number;
  positions: Float32Array;
  colors: Float32Array;
}

// Parse raw buffer from Rust: [count:u32][x:i32...][y:i32...][type:i32...][elev:f32...]
export function parseRawTileBuffer(buffer: Buffer): RawTileData {
  const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const count = dataView.getUint32(0, true);
  
  const baseOffset = buffer.byteOffset + 4;
  const xData = new Int32Array(buffer.buffer, baseOffset, count);
  const yData = new Int32Array(buffer.buffer, baseOffset + count * 4, count);
  const typeData = new Int32Array(buffer.buffer, baseOffset + count * 8, count);
  const elevData = new Float32Array(buffer.buffer, baseOffset + count * 12, count);
  
  return { count, xData, yData, typeData, elevData };
}

// WGSL compute shader as a string for Use.GPU Kernel
export const TILE_TRANSFORM_WGSL = /* wgsl */`
// Tile type → RGB color lookup
fn tile_color(tile_type: i32, scale: f32) -> vec3<f32> {
  switch tile_type {
    case 0: { return vec3<f32>(0.2, 0.5, 0.8) * scale; }  // water
    case 1: { return vec3<f32>(0.3, 0.7, 0.3) * scale; }  // grass
    case 2: { return vec3<f32>(0.6, 0.6, 0.5) * scale; }  // rock
    case 3: { return vec3<f32>(0.9, 0.9, 0.95) * scale; } // snow
    case 4: { return vec3<f32>(0.8, 0.7, 0.4) * scale; }  // sand
    case 5: { return vec3<f32>(0.1, 0.4, 0.1) * scale; }  // forest
    default: { return vec3<f32>(0.5, 0.5, 0.5) * scale; } // unknown
  }
}

@link fn getTileSpacing() -> f32 {};
@link fn getColorScale() -> f32 {};
@link fn getTileX(i: u32) -> i32 {};
@link fn getTileY(i: u32) -> i32 {};
@link fn getTileType(i: u32) -> i32 {};
@link fn getTileElevation(i: u32) -> f32 {};

@export fn getPosition(i: u32) -> vec4<f32> {
  let spacing = getTileSpacing();
  let x = f32(getTileX(i)) * spacing;
  let y = f32(getTileY(i)) * spacing;
  let z = getTileElevation(i);
  return vec4<f32>(x, y, z, 1.0);
}

@export fn getColor(i: u32) -> vec4<f32> {
  let scale = getColorScale();
  let tile_type = getTileType(i);
  let rgb = tile_color(tile_type, scale);
  return vec4<f32>(rgb, 1.0);
}
`;

// For quick CPU fallback when GPU compute isn't needed
export function transformTilesCPU(
  rawData: RawTileData,
  tileSpacing: number = 1.0,
  colorScale: number = 1.0
): GpuTileBuffers {
  const { count, xData, yData, typeData, elevData } = rawData;
  
  const positions = new Float32Array(count * 4);
  const colors = new Float32Array(count * 4);
  
  const tileColor = (type: number): [number, number, number] => {
    switch (type) {
      case 0: return [0.2 * colorScale, 0.5 * colorScale, 0.8 * colorScale];
      case 1: return [0.3 * colorScale, 0.7 * colorScale, 0.3 * colorScale];
      case 2: return [0.6 * colorScale, 0.6 * colorScale, 0.5 * colorScale];
      case 3: return [0.9 * colorScale, 0.9 * colorScale, 0.95 * colorScale];
      case 4: return [0.8 * colorScale, 0.7 * colorScale, 0.4 * colorScale];
      case 5: return [0.1 * colorScale, 0.4 * colorScale, 0.1 * colorScale];
      default: return [0.5 * colorScale, 0.5 * colorScale, 0.5 * colorScale];
    }
  };
  
  for (let i = 0; i < count; i++) {
    const pi = i * 4;
    positions[pi] = xData[i] * tileSpacing;
    positions[pi + 1] = yData[i] * tileSpacing;
    positions[pi + 2] = elevData[i];
    positions[pi + 3] = 1.0;
    
    const [r, g, b] = tileColor(typeData[i]);
    colors[pi] = r;
    colors[pi + 1] = g;
    colors[pi + 2] = b;
    colors[pi + 3] = 1.0;
  }
  
  return { count, positions, colors };
}
