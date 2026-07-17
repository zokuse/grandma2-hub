const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1800,
    height: 950,
    title: 'GrandMA2 Hub',
    backgroundColor: '#1e1e1e',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false
    }
  });
  
  // Sembunyikan menu bar bawaan Electron (File, Edit, View, Window, dll)
  mainWindow.setMenu(null);

  // Load the exactly same HTML file from PyQt6 project
  mainWindow.loadFile(path.join(__dirname, 'assets', 'shell-app', 'dist', 'index.html'));
  
  // Uncomment to open Developer Tools automatically
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  const { registerIpcHandlers } = require('./backend/ipcHandlers');
  registerIpcHandlers();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
