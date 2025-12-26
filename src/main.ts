import { app, BrowserWindow, ipcMain, globalShortcut } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Reference for screenshots
let mainWindowRef: BrowserWindow | null = null;

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Save reference for screenshots
  mainWindowRef = mainWindow;

  // Log renderer console messages to the terminal
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const levels = ['VERBOSE', 'INFO', 'WARNING', 'ERROR'];
    console.log(`[Renderer ${levels[level] || level}] ${message} (${sourceId}:${line})`);
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// Enable WebGPU with Vulkan on Wayland
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('enable-features', 'Vulkan');
app.commandLine.appendSwitch('use-angle', 'vulkan');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

// Screenshot functionality
async function takeScreenshot() {
  if (!mainWindowRef) return;
  
  const screenshotDir = path.join(app.getPath('userData'), '..', 'ultralogi-screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `screenshot-${timestamp}.png`;
  const filepath = path.join(screenshotDir, filename);
  
  try {
    const image = await mainWindowRef.webContents.capturePage();
    fs.writeFileSync(filepath, image.toPNG());
    console.log(`📸 Screenshot saved: ${filepath}`);
    return filepath;
  } catch (err) {
    console.error('Screenshot error:', err);
    return null;
  }
}

// IPC handler for screenshots
ipcMain.handle('take-screenshot', async () => {
  return await takeScreenshot();
});

// IPC handler for fixed-path screenshot (for automated testing)
ipcMain.handle('take-screenshot-fixed', async () => {
  if (!mainWindowRef) return null;
  const filepath = '/tmp/ultralogi-screenshot.png';
  try {
    const image = await mainWindowRef.webContents.capturePage();
    fs.writeFileSync(filepath, image.toPNG());
    console.log(`📸 Screenshot saved: ${filepath}`);
    return filepath;
  } catch (err) {
    console.error('Screenshot error:', err);
    return null;
  }
});

// Register global shortcut for screenshots (F12)
app.whenReady().then(() => {
  globalShortcut.register('F12', () => {
    takeScreenshot();
  });
  console.log('📸 Press F12 to take a screenshot');
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
