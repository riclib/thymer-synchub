import { BrowserWindow, ipcMain } from 'electron';
import { setWorkspace, configExists } from './config';

let setupWindow: BrowserWindow | null = null;

/**
 * Check if first-run setup is needed
 */
export function needsSetup(): boolean {
    return !configExists();
}

/**
 * Show the setup dialog and return the configured workspace
 */
export function showSetupDialog(): Promise<string> {
    return new Promise((resolve, reject) => {
        setupWindow = new BrowserWindow({
            width: 400,
            height: 280,
            resizable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            title: 'Thymer Desktop Setup',
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
            },
        });

        setupWindow.setMenuBarVisibility(false);

        const html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a2e;
            color: #eee;
            padding: 32px;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        h1 {
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 8px;
        }
        p {
            color: #888;
            font-size: 14px;
            margin-bottom: 24px;
        }
        label {
            display: block;
            font-size: 14px;
            margin-bottom: 8px;
            color: #aaa;
        }
        .input-row {
            display: flex;
            align-items: center;
            gap: 0;
            margin-bottom: 8px;
        }
        input {
            flex: 1;
            padding: 12px 16px;
            font-size: 16px;
            border: 1px solid #333;
            border-radius: 8px 0 0 8px;
            background: #252540;
            color: #fff;
            outline: none;
        }
        input:focus {
            border-color: #4a9eff;
        }
        .suffix {
            padding: 12px 16px;
            font-size: 16px;
            background: #333;
            border: 1px solid #333;
            border-left: none;
            border-radius: 0 8px 8px 0;
            color: #888;
        }
        .preview {
            font-size: 13px;
            color: #666;
            margin-bottom: 24px;
            height: 20px;
        }
        .preview.valid {
            color: #4ade80;
        }
        button {
            width: 100%;
            padding: 14px;
            font-size: 16px;
            font-weight: 600;
            border: none;
            border-radius: 8px;
            background: #4a9eff;
            color: white;
            cursor: pointer;
            margin-top: auto;
        }
        button:hover {
            background: #3a8eef;
        }
        button:disabled {
            background: #333;
            color: #666;
            cursor: not-allowed;
        }
    </style>
</head>
<body>
    <h1>Welcome to Thymer Desktop</h1>
    <p>Enter your Thymer workspace name to get started.</p>

    <label for="workspace">Workspace</label>
    <div class="input-row">
        <input type="text" id="workspace" placeholder="yourname" autofocus>
        <span class="suffix">.thymer.com</span>
    </div>
    <div class="preview" id="preview"></div>

    <button id="continue" disabled>Continue</button>

    <script>
        const { ipcRenderer } = require('electron');
        const input = document.getElementById('workspace');
        const preview = document.getElementById('preview');
        const button = document.getElementById('continue');

        input.addEventListener('input', () => {
            const value = input.value.toLowerCase().trim();
            if (value && /^[a-z0-9-]+$/.test(value)) {
                preview.textContent = 'https://' + value + '.thymer.com';
                preview.className = 'preview valid';
                button.disabled = false;
            } else if (value) {
                preview.textContent = 'Only lowercase letters, numbers, and hyphens';
                preview.className = 'preview';
                button.disabled = true;
            } else {
                preview.textContent = '';
                preview.className = 'preview';
                button.disabled = true;
            }
        });

        button.addEventListener('click', () => {
            const value = input.value.toLowerCase().trim();
            if (value) {
                ipcRenderer.send('setup-complete', value);
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !button.disabled) {
                button.click();
            }
        });
    </script>
</body>
</html>`;

        setupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

        // Handle setup completion
        ipcMain.once('setup-complete', (event, workspace: string) => {
            try {
                setWorkspace(workspace);
                setupWindow?.close();
                setupWindow = null;
                resolve(workspace);
            } catch (e: any) {
                reject(e);
            }
        });

        // Handle window close without completing setup
        setupWindow.on('closed', () => {
            setupWindow = null;
            reject(new Error('Setup cancelled'));
        });
    });
}
