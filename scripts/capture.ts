#!/usr/bin/env npx ts-node
/**
 * Capture screenshot from running dev server
 * This does NOT launch or kill the Electron app - it just captures from localhost:5173
 */

import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');
const DEV_SERVER_URL = 'http://[::1]:5173';  // IPv6 localhost

async function capture() {
  // Ensure screenshot dir exists
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  console.log(`📷 Connecting to ${DEV_SERVER_URL}...`);
  
  const browser = await chromium.launch({ 
    headless: true,
  });
  
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  
  try {
    await page.goto(DEV_SERVER_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    // Wait for voxels to load
    console.log('⏳ Waiting for app to render...');
    await page.waitForTimeout(3000);
    
    // Take screenshot
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = path.join(SCREENSHOT_DIR, `capture-${timestamp}.png`);
    
    await page.screenshot({ path: filepath });
    console.log(`✅ Screenshot saved: ${filepath}`);
    
    // Also get console logs
    const logs: string[] = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
    
  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await browser.close();
  }
}

capture();
