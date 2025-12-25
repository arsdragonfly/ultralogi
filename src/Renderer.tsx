import React, { render } from '@use-gpu/live';

window.onload = async () => {
  const { App } = await import('./App');
  render(<App />);
};
