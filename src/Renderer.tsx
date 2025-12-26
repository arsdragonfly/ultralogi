import React, { render } from '@use-gpu/live';
import { VoxelDemo } from './VoxelDemo';

console.log("Renderer.tsx loaded, readyState:", document.readyState);

// For ES modules, the page might already be loaded
if (document.readyState === 'complete') {
  console.log("DOM already complete, rendering immediately");
  render(<VoxelDemo />);
} else {
  window.onload = () => {
    console.log("window.onload fired, rendering VoxelDemo");
    render(<VoxelDemo />);
  };
}
