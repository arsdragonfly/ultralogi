// GPU Compute Shader: Transform raw tile data → GPU-ready positions + colors
// This replaces CPU-side transformation with massively parallel GPU compute

struct Uniforms {
    tile_spacing: f32,
    color_scale: f32,
    count: u32,
    _pad: u32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// Input: raw tile data (SoA layout from DuckDB)
@group(0) @binding(1) var<storage, read> tile_x: array<i32>;
@group(0) @binding(2) var<storage, read> tile_y: array<i32>;
@group(0) @binding(3) var<storage, read> tile_type: array<i32>;
@group(0) @binding(4) var<storage, read> tile_elevation: array<f32>;

// Output: GPU-ready vertex data
@group(0) @binding(5) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> colors: array<vec4<f32>>;

// Tile type → RGB color lookup (same as Rust version)
fn tile_color(tile_type: i32, scale: f32) -> vec3<f32> {
    switch tile_type {
        case 0: { return vec3<f32>(0.2, 0.5, 0.8) * scale; }  // water - blue
        case 1: { return vec3<f32>(0.3, 0.7, 0.3) * scale; }  // grass - green
        case 2: { return vec3<f32>(0.6, 0.6, 0.5) * scale; }  // rock - gray
        case 3: { return vec3<f32>(0.9, 0.9, 0.95) * scale; } // snow - white
        case 4: { return vec3<f32>(0.8, 0.7, 0.4) * scale; }  // sand - yellow
        case 5: { return vec3<f32>(0.1, 0.4, 0.1) * scale; }  // forest - dark green
        default: { return vec3<f32>(0.5, 0.5, 0.5) * scale; } // unknown - gray
    }
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;
    
    // Bounds check
    if (idx >= uniforms.count) {
        return;
    }
    
    // Transform position: (x, y) → (x * spacing, y * spacing, elevation, 1.0)
    let x = f32(tile_x[idx]) * uniforms.tile_spacing;
    let y = f32(tile_y[idx]) * uniforms.tile_spacing;
    let z = tile_elevation[idx];
    positions[idx] = vec4<f32>(x, y, z, 1.0);
    
    // Transform color: tile_type → (r, g, b, 1.0)
    let rgb = tile_color(tile_type[idx], uniforms.color_scale);
    colors[idx] = vec4<f32>(rgb, 1.0);
}
