/**
 * Screenshot utility for Electron app
 * 
 * Usage: npx ts-node tests/screenshot.ts
 * 
 * Takes a screenshot of the running Electron app and saves it to screenshots/
 */

import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

async function takeScreenshot() {
  const screenshotDir = path.join(__dirname, '..', 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  console.log('🚀 Launching Electron app...');
  
  // Launch the Electron app
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '..', '.vite', 'build', 'main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'development',
    },
  });

  // Wait for the first window
  const window = await electronApp.firstWindow();
  console.log('📺 Window opened:', await window.title());

  // Wait for the app to fully load (wait for voxels to load)
  console.log('⏳ Waiting for app to load...');
  await window.waitForTimeout(3000);

  // Take screenshot
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const screenshotPath = path.join(screenshotDir, `screenshot-${timestamp}.png`);
  
  await window.screenshot({ path: screenshotPath });
  console.log(`📸 Screenshot saved: ${screenshotPath}`);

  // Get console logs
  window.on('console', (msg) => {
    console.log(`[Browser ${msg.type()}] ${msg.text()}`);
  });

  // Close the app
  await electronApp.close();
  console.log('✅ Done!');
}

takeScreenshot().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
