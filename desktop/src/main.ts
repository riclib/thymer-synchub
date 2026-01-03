import { app, BrowserWindow, Tray, Menu, nativeImage, shell } from 'electron';
import * as path from 'path';
import { startHttpServer, stopHttpServer } from './http-server';
import { ThymerBridge } from './thymer-bridge';
import { LLMRuntime } from './llm-runtime';
import { needsSetup, showSetupDialog } from './setup-dialog';
import { loadConfig, getWorkspace, getThymerUrl } from './config';

// Keep references to prevent garbage collection
let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let thymerBridge: ThymerBridge | null = null;
let llmRuntime: LLMRuntime | null = null;

const HTTP_PORT = 9847;

async function createWindow() {
    const workspace = getWorkspace() || 'unknown';
    const thymerUrl = getThymerUrl() || 'https://thymer.com';

    mainWindow = new BrowserWindow({
        width: 420,
        height: 320,
        show: false, // Start hidden (system tray app)
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    // Simple status page
    mainWindow.loadURL(`data:text/html,
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    padding: 24px;
                    background: #1a1a2e;
                    color: #eee;
                }
                h1 { font-size: 18px; margin-bottom: 4px; }
                .workspace {
                    font-size: 13px;
                    color: #888;
                    margin-bottom: 20px;
                }
                .workspace a {
                    color: #4a9eff;
                    text-decoration: none;
                }
                .workspace a:hover { text-decoration: underline; }
                .status { margin: 10px 0; display: flex; align-items: center; }
                .dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    margin-right: 10px;
                    flex-shrink: 0;
                }
                .dot.on { background: #4ade80; }
                .dot.blue { background: #4a9eff; }
                .dot.off { background: #666; }
                .label { color: #888; width: 100px; }
                .value { color: #eee; }
            </style>
        </head>
        <body>
            <h1>Thymer Desktop</h1>
            <div class="workspace">
                <a href="${thymerUrl}" id="thymer-link">${thymerUrl}</a>
            </div>
            <div class="status">
                <span class="dot blue"></span>
                <span class="label">HTTP API</span>
                <span class="value">:${HTTP_PORT}</span>
            </div>
            <div class="status">
                <span class="dot blue"></span>
                <span class="label">WebSocket</span>
                <span class="value">:9848</span>
            </div>
            <div class="status">
                <span class="dot" id="thymer-dot"></span>
                <span class="label">SyncHub</span>
                <span class="value" id="thymer-status">Waiting for connection...</span>
            </div>
            <div class="status">
                <span class="dot" id="llm-dot"></span>
                <span class="label">Local LLM</span>
                <span class="value" id="llm-status">Not running</span>
            </div>
            <script>
                document.getElementById('thymer-link').addEventListener('click', (e) => {
                    e.preventDefault();
                    require('electron').shell.openExternal('${thymerUrl}');
                });
            </script>
        </body>
        </html>
    `);

    mainWindow.on('close', (e) => {
        // Hide instead of close
        e.preventDefault();
        mainWindow?.hide();
    });
}

function createTray() {
    const workspace = getWorkspace() || 'unknown';
    const thymerUrl = getThymerUrl() || 'https://thymer.com';

    // Create a simple tray icon (circle)
    const icon = nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAA' +
        'hklEQVR4nGNgGLTg/weG/0T4/+8/BwYGhv8fGBj+E+X/3/8MDOB4kAEDA8P//x8YGP7//8DAQJz/' +
        'f/8zMPz//5+B4T9R/v/7z8DA8P8/A8P//0T5//c/AwPD/w8MDP+J8v/vfwYGhv8fGBj+E+X/3/8M' +
        'DAz/PzAw/CfK/7//GRj+/2dg+E8MAABpOSxZpNvQ4wAAAABJRU5ErkJggg=='
    );

    tray = new Tray(icon);
    tray.setToolTip(`Thymer Desktop - ${workspace}`);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: `Workspace: ${workspace}`,
            enabled: false,
        },
        {
            label: 'Open Thymer',
            click: () => shell.openExternal(thymerUrl),
        },
        {
            label: 'Show Status',
            click: () => mainWindow?.show(),
        },
        { type: 'separator' },
        {
            label: 'SyncHub',
            submenu: [
                {
                    label: thymerBridge?.isConnected() ? 'Connected' : 'Waiting...',
                    enabled: false
                },
                { label: 'Restart Server', click: () => thymerBridge?.reconnect() },
            ]
        },
        {
            label: 'Local LLM',
            submenu: [
                { label: 'Start', click: () => llmRuntime?.start() },
                { label: 'Stop', click: () => llmRuntime?.stop() },
                { type: 'separator' },
                { label: 'Model: qwen2.5:7b', enabled: false },
            ]
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
}

async function initialize() {
    // Start HTTP server for CLI and browser proxy
    await startHttpServer(HTTP_PORT);
    console.log(`[Desktop] HTTP server started on port ${HTTP_PORT}`);

    // Initialize Thymer bridge (WebSocket server)
    thymerBridge = new ThymerBridge();

    // Initialize LLM runtime (optional, starts on demand)
    llmRuntime = new LLMRuntime();
}

app.whenReady().then(async () => {
    // Check for first-run setup
    if (needsSetup()) {
        try {
            const workspace = await showSetupDialog();
            console.log(`[Desktop] Configured workspace: ${workspace}`);
        } catch (e) {
            console.log('[Desktop] Setup cancelled, quitting');
            app.quit();
            return;
        }
    }

    const config = loadConfig();
    console.log(`[Desktop] Starting for workspace: ${config?.workspace}`);

    await initialize();
    createTray();
    await createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    // Don't quit on window close (system tray app)
});

app.on('before-quit', () => {
    stopHttpServer();
    thymerBridge?.disconnect();
    llmRuntime?.stop();
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        mainWindow?.show();
    });
}
