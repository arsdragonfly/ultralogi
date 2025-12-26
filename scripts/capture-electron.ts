/**
 * Capture screenshot from Electron app using Playwright's Electron support
 * This launches Electron directly and captures WebGPU content
 */

import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');

async function captureElectron() {
  // Ensure screenshot dir exists
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  // First, build the app if needed
  const mainJsPath = path.join(__dirname, '..', '.vite', 'build', 'main.js');
  if (!fs.existsSync(mainJsPath)) {
    console.log('⚙️  Building app first...');
    execSync('npm run package', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  }

  console.log('🚀 Launching Electron app...');
  
  // Launch Electron with WebGPU flags
  const electronApp = await electron.launch({
    args: [mainJsPath],
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
    executablePath: undefined, // Use the default Electron
  });

  // Get the main window (not DevTools)
  const windows = await electronApp.windows();
  let window = windows.find(w => !w.url().includes('devtools'));
  
  if (!window) {
    // Wait for main window if not ready
    window = await electronApp.firstWindow();
    await window.waitForTimeout(1000);
    const allWindows = await electronApp.windows();
    window = allWindows.find(w => !w.url().includes('devtools')) || window;
  }
  
  console.log('📺 Window opened:', await window.title(), 'URL:', await window.url());

  // Collect console logs
  const logs: string[] = [];
  window.on('console', (msg) => {
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
    if (text.includes('voxel') || text.includes('Voxel') || text.includes('error') || text.includes('Error')) {
      console.log(`  [Console] ${text}`);
    }
  });

  // Wait for the app to load and render
  console.log('⏳ Waiting for app to render (5 seconds)...');
  await window.waitForTimeout(5000);

  // Take screenshot
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filepath = path.join(SCREENSHOT_DIR, `electron-${timestamp}.png`);
  
  await window.screenshot({ path: filepath });
  console.log(`✅ Screenshot saved: ${filepath}`);

  // Print relevant console output
  console.log('\n--- Console Output ---');
  logs.filter(l => l.includes('voxel') || l.includes('Voxel') || l.includes('WebGPU') || l.includes('error'))
      .forEach(l => console.log(l));
  console.log('--- End ---\n');

  // Close the app
  await electronApp.close();
  console.log('🎉 Done!');
  
  return filepath;
}

captureElectron().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
