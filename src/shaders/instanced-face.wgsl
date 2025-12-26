// Instanced face vertex shader
// Uses stored instance index from loadInstance

@link fn getBasePosition(index: u32) -> vec4<f32> {}
@link fn getInstanceTransform(index: u32) -> mat4x4<f32> {}
@link fn getInstanceIndex() -> u32 { return 0u; }

@export fn getPosition(vertexIndex: u32) -> vec4<f32> {
  // Get base position from unit cube mesh (36 vertices)
  let basePos = getBasePosition(vertexIndex);
  
  // Get current instance index (set by loadInstance before this is called)
  let instanceIndex = getInstanceIndex();
  
  // Get transform for this instance
  let transform = getInstanceTransform(instanceIndex);
  
  // Apply transform
  return transform * basePos;
}
