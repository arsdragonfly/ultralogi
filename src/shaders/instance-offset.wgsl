// Instance offset shader - provides position offset per instance
@link fn getInstanceOffset(index: u32) -> vec4<f32> {}

@export fn loadInstance(index: u32) {
  // This is a transform that adds the instance offset to the vertex position
  // The vertex position will be transformed by adding this offset
}

@export fn getInstance(index: u32) -> vec4<f32> {
  return getInstanceOffset(index);
}

