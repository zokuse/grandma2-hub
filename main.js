const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const log = require('electron-log');

// Enable crash logging
Object.assign(console, log.functions);
log.errorHandler.startCatching();

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
let splashWindow = null;

function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 400,
        height: 300,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        icon: path.join(__dirname, 'assets', 'icon.ico')
    });
    splashWindow.loadFile(path.join(__dirname, 'assets', 'splash.html'));
    splashWindow.on('closed', () => {
        splashWindow = null;
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1800,
        height: 950,
        title: 'GrandMA2 Hub',
        backgroundColor: '#1e1e1e',
        icon: path.join(__dirname, 'assets', 'icon.ico'),
        frame: false,
        titleBarStyle: 'hidden',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInSubFrames: true,
            sandbox: false
        }
    });

    // Sembunyikan menu bar bawaan Electron (File, Edit, View, Window, dll)
    mainWindow.setMenu(null);

    // Load the shell app — works in both dev and packaged (asar) contexts
    mainWindow.loadFile(path.join(__dirname, 'assets', 'shell-app', 'dist', 'index.html'));

    // mainWindow.webContents.openDevTools();

    mainWindow.once('ready-to-show', () => {
        setTimeout(() => {
            if (splashWindow) {
                splashWindow.close();
            }
            mainWindow.show();
        }, 1200); // 1.2s delay to ensure React iframes fully mount
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    const { registerIpcHandlers } = require('./backend/ipcHandlers');
    registerIpcHandlers();

    // ─── Security Hardening ──────────────────────────────────────────────────
    app.on('web-contents-created', (event, contents) => {
        contents.on('will-navigate', (e, url) => {
            if (!url.startsWith('file://')) {
                console.warn('[Security] Blocked navigation to:', url);
                e.preventDefault();
            }
        });
        contents.setWindowOpenHandler(({ url }) => {
            console.warn('[Security] Blocked window.open to:', url);
            return { action: 'deny' };
        });
    });

    ipcMain.on('switch-tab', (event, toolId) => {
        if (mainWindow) {
            mainWindow.webContents.send('switch-tab-request', toolId);
        }
    });

    // ─── Update Restart Handler ────────────────────────────────────────────
    ipcMain.on('restart-and-install', () => {
        try {
            const { autoUpdater } = require('electron-updater');
            autoUpdater.quitAndInstall();
        } catch (e) {
            console.error('[AutoUpdater] quitAndInstall failed:', e.message);
        }
    });
    
    // ─── Window Controls ──────────────────────────────────────────────────
    ipcMain.on('window-minimize', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) win.minimize();
    });
    ipcMain.on('window-maximize', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            if (win.isMaximized()) win.restore();
            else win.maximize();
        }
    });
    ipcMain.on('window-close', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) win.close();
    });
    // ──────────────────────────────────────────────────────────────────────

    createSplashWindow();
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

        // Clear updater cache to prevent stale latest.yml caching issues
        try {
            const fs = require('fs');
            const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local');
            const updaterCacheDir = path.join(localAppData, `${app.name}-updater`);
            if (fs.existsSync(updaterCacheDir)) {
                fs.rmSync(updaterCacheDir, { recursive: true, force: true });
                console.log('[AutoUpdater] Cleared stale updater cache');
            }
        } catch (cacheErr) {
            console.error('[AutoUpdater] Failed to clear cache:', cacheErr.message);
        }

        autoUpdater.checkForUpdates();
    } catch (e) {
        console.log('[AutoUpdater] Not available in this build:', e.message);
    }
    // ──────────────────────────────────────────────────────────────────────
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});
