// Per-instance transform and color shader

@link fn getInstanceOffset(index: u32) -> vec4<f32> {}
@link fn getInstanceColor(index: u32) -> vec4<f32> {}

var<private> currentOffset: vec4<f32>;
var<private> currentColor: vec4<f32>;

@export fn loadInstance(index: u32) {
  currentOffset = getInstanceOffset(index);
  currentColor = getInstanceColor(index);
}

@export fn transformPosition(p: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(p.xyz + currentOffset.xyz, 1.0);
}

@export fn transformDifferential(v: vec4<f32>, b: vec4<f32>, c: bool) -> vec4<f32> {
  return v;
}

@export fn getColor(index: u32) -> vec4<f32> {
  return currentColor;
}
