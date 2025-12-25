import React from '@use-gpu/live';

export const makeFallback = (error: Error) => {
  return (
    <div className="error-message">
      <h2>WebGPU Error</h2>
      <p>{error.message}</p>
      <p>
        WebGPU requires a compatible browser and GPU. On Linux, you may need to:
      </p>
      <ul>
        <li>Use Chrome/Chromium with --enable-unsafe-webgpu flag</li>
        <li>Enable WebGPU in chrome://flags</li>
        <li>Have up-to-date GPU drivers</li>
      </ul>
      <p>
        <strong>Note:</strong> Electron is started with --enable-unsafe-webgpu by default in this app.
      </p>
    </div>
  );
};
