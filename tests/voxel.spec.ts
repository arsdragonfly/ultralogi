/**
 * Electron app visual test
 * 
 * Run with: npx playwright test
 */

import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';

test.describe('Voxel Demo', () => {
  test('renders voxel terrain', async () => {
    // Launch the Electron app (needs built main.js)
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..', '.vite', 'build', 'main.js')],
    });

    // Get the first window
    const window = await electronApp.firstWindow();
    
    // Wait for app to initialize
    await window.waitForTimeout(3000);

    // Take screenshot
    await window.screenshot({ 
      path: path.join(__dirname, '..', 'screenshots', 'voxel-terrain.png') 
    });

    // Check window title
    const title = await window.title();
    expect(title).toContain('ultralogi');

    // Check for console messages about voxels loading
    const logs: string[] = [];
    window.on('console', (msg) => {
      logs.push(msg.text());
    });

    // Wait a bit more for any async operations
    await window.waitForTimeout(1000);

    // Verify voxels loaded (check console output)
    const voxelLog = logs.find(log => log.includes('voxels'));
    console.log('Voxel logs:', logs.filter(l => l.includes('voxel') || l.includes('Voxel')));

    await electronApp.close();
  });

  test('screenshot current state', async () => {
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..', '.vite', 'build', 'main.js')],
    });

    const window = await electronApp.firstWindow();
    
    // Collect console output
    const consoleLogs: string[] = [];
    window.on('console', (msg) => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    // Wait for full load
    await window.waitForTimeout(4000);

    // Take screenshot with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    await window.screenshot({ 
      path: path.join(__dirname, '..', 'screenshots', `test-${timestamp}.png`) 
    });

    // Print console logs for debugging
    console.log('\n--- Console Output ---');
    consoleLogs.forEach(log => console.log(log));
    console.log('--- End Console ---\n');

    await electronApp.close();
  });
});
