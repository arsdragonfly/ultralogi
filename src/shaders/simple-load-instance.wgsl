// Simple loadInstance shader
// Stores instance index for use by position shader

var<private> currentInstance: u32;

@export fn loadInstance(index: u32) {
  currentInstance = index;
}

@export fn getInstanceIndex() -> u32 {
  return currentInstance;
}
