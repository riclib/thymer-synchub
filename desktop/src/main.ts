import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import { startHttpServer, stopHttpServer } from './http-server';
import { ThymerBridge } from './thymer-bridge';
import { LLMRuntime } from './llm-runtime';

// Keep references to prevent garbage collection
let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let thymerBridge: ThymerBridge | null = null;
let llmRuntime: LLMRuntime | null = null;

const HTTP_PORT = 9847;

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 400,
        height: 300,
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
                    padding: 20px;
                    background: #1a1a2e;
                    color: #eee;
                }
                h1 { font-size: 18px; margin-bottom: 20px; }
                .status { margin: 10px 0; }
                .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; }
                .dot.on { background: #4ade80; }
                .dot.off { background: #666; }
            </style>
        </head>
        <body>
            <h1>Thymer Desktop</h1>
            <div class="status"><span class="dot on"></span>HTTP Server: :${HTTP_PORT}</div>
            <div class="status"><span class="dot" id="thymer-dot"></span>Thymer: <span id="thymer-status">Connecting...</span></div>
            <div class="status"><span class="dot" id="llm-dot"></span>Local LLM: <span id="llm-status">Not running</span></div>
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
    // Create a simple tray icon (circle)
    const icon = nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAA' +
        'hklEQVR4nGNgGLTg/weG/0T4/+8/BwYGhv8fGBj+E+X/3/8MDOB4kAEDA8P//x8YGP7//8DAQJz/' +
        'f/8zMPz//5+B4T9R/v/7z8DA8P8/A8P//0T5//c/AwPD/w8MDP+J8v/vfwYGhv8fGBj+E+X/3/8M' +
        'DAz/PzAw/CfK/7//GRj+/2dg+E8MAABpOSxZpNvQ4wAAAABJRU5ErkJggg=='
    );

    tray = new Tray(icon);
    tray.setToolTip('Thymer Desktop');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show Status',
            click: () => mainWindow?.show()
        },
        { type: 'separator' },
        {
            label: 'Thymer',
            submenu: [
                { label: 'Connected', enabled: false },
                { label: 'Reconnect', click: () => thymerBridge?.reconnect() },
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

    // Initialize Thymer bridge (WebSocket to Thymer)
    thymerBridge = new ThymerBridge();

    // Initialize LLM runtime (optional, starts on demand)
    llmRuntime = new LLMRuntime();
}

app.whenReady().then(async () => {
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
