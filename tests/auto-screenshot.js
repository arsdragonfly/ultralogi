// Auto-screenshot script - run with: npx electron tests/auto-screenshot.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('no-sandbox');

app.whenReady().then(async () => {
  console.log('Launching window...');
  
  const win = new BrowserWindow({ 
    width: 1280, 
    height: 720, 
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });
  
  // Load the dev server
  await win.loadURL('http://localhost:5173');
  console.log('Page loaded, waiting for voxels...');
  
  // Wait for voxels to load and render
  await new Promise(r => setTimeout(r, 5000));
  
  // Take screenshot
  const image = await win.webContents.capturePage();
  const screenshotDir = path.join(__dirname, '..', 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
  
  const filepath = path.join(screenshotDir, 'auto-screenshot.png');
  fs.writeFileSync(filepath, image.toPNG());
  console.log('📸 Screenshot saved:', filepath);
  
  app.quit();
});

app.on('window-all-closed', () => app.quit());
