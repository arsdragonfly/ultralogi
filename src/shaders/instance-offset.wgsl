// Custom instance shader for voxel position offsets
// Links to external position data source

@link fn getInstancePosition(index: u32) -> vec4<f32> {}

// Private variables to store loaded instance data
var<private> instanceTransform: mat4x4<f32>;
var<private> instanceNormal: mat3x3<f32>;

// Load instance data - creates translation matrix from position offset
@export fn loadInstance(index: u32) {
  let pos = getInstancePosition(index);
  
  // Create translation matrix from position
  instanceTransform = mat4x4<f32>(
    vec4<f32>(1.0, 0.0, 0.0, 0.0),
    vec4<f32>(0.0, 1.0, 0.0, 0.0),
    vec4<f32>(0.0, 0.0, 1.0, 0.0),
    vec4<f32>(pos.x, pos.y, pos.z, 1.0)
  );
  
  // Identity normal matrix (no rotation/scale)
  instanceNormal = mat3x3<f32>(
    vec3<f32>(1.0, 0.0, 0.0),
    vec3<f32>(0.0, 1.0, 0.0),
    vec3<f32>(0.0, 0.0, 1.0)
  );
}

// Return the transform matrix
@export fn getTransformMatrix() -> mat4x4<f32> {
  return instanceTransform;
}

// Return the normal matrix
@export fn getNormalMatrix() -> mat3x3<f32> {
  return instanceNormal;
}
