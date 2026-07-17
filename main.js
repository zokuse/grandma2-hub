const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// ─── Single Instance Lock ──────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}
// ──────────────────────────────────────────────────────────────────────────

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
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

    // Load the shell app — works in both dev and packaged (asar) contexts
    mainWindow.loadFile(path.join(__dirname, 'assets', 'shell-app', 'dist', 'index.html'));

    // Uncomment to open Developer Tools automatically
    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    const { registerIpcHandlers } = require('./backend/ipcHandlers');
    registerIpcHandlers();

    // ─── Update Restart Handler ────────────────────────────────────────────
    ipcMain.on('restart-and-install', () => {
        try {
            const { autoUpdater } = require('electron-updater');
            autoUpdater.quitAndInstall();
        } catch (e) {
            console.error('[AutoUpdater] quitAndInstall failed:', e.message);
        }
    });
    // ──────────────────────────────────────────────────────────────────────

    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // ─── Auto-Updater ──────────────────────────────────────────────────────
    try {
        const { autoUpdater } = require('electron-updater');

        // Silent background check — no popups
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;

        autoUpdater.on('update-available', (info) => {
            console.log(`[AutoUpdater] Update available: v${info.version}`);
        });

        autoUpdater.on('download-progress', (progress) => {
            console.log(`[AutoUpdater] Downloading: ${Math.round(progress.percent)}%`);
        });

        autoUpdater.on('update-downloaded', (info) => {
            console.log(`[AutoUpdater] Update downloaded: v${info.version}`);
            // Notify the renderer so the UI can show the update banner
            if (mainWindow) {
                mainWindow.webContents.send('update-ready', { version: info.version });
            }
        });

        autoUpdater.on('error', (err) => {
            console.error('[AutoUpdater] Error:', err.message);
        });

        autoUpdater.checkForUpdates();
    } catch (e) {
        console.log('[AutoUpdater] Not available in this build:', e.message);
    }
    // ──────────────────────────────────────────────────────────────────────
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});
