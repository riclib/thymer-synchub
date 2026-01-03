import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Local LLM Runtime Manager
 *
 * Manages a bundled or system LLM runtime (Ollama, llama.cpp, etc.)
 * Provides:
 * - Automatic download of models
 * - Start/stop lifecycle
 * - Health monitoring
 */
export class LLMRuntime {
    private process: ChildProcess | null = null;
    private running = false;
    private model = 'qwen2.5:7b';
    private port = 11434;

    // Check for bundled or system Ollama
    private ollamaPath: string | null = null;

    constructor() {
        this.detectOllama();
    }

    private detectOllama() {
        // Check bundled location first
        const bundledPaths = [
            path.join(process.resourcesPath || '', 'ollama', 'ollama'),
            path.join(__dirname, '..', 'ollama', 'ollama'),
        ];

        for (const p of bundledPaths) {
            if (fs.existsSync(p)) {
                this.ollamaPath = p;
                console.log(`[LLM] Found bundled Ollama at ${p}`);
                return;
            }
        }

        // Check system PATH
        const systemPaths = process.env.PATH?.split(path.delimiter) || [];
        const ollamaName = os.platform() === 'win32' ? 'ollama.exe' : 'ollama';

        for (const dir of systemPaths) {
            const p = path.join(dir, ollamaName);
            if (fs.existsSync(p)) {
                this.ollamaPath = p;
                console.log(`[LLM] Found system Ollama at ${p}`);
                return;
            }
        }

        // macOS app bundle location
        const macAppPath = '/Applications/Ollama.app/Contents/Resources/ollama';
        if (fs.existsSync(macAppPath)) {
            this.ollamaPath = macAppPath;
            console.log(`[LLM] Found Ollama.app at ${macAppPath}`);
            return;
        }

        console.log('[LLM] Ollama not found - local LLM features disabled');
    }

    isAvailable(): boolean {
        return this.ollamaPath !== null;
    }

    isRunning(): boolean {
        return this.running;
    }

    getModel(): string {
        return this.model;
    }

    setModel(model: string) {
        this.model = model;
    }

    async start(): Promise<void> {
        if (this.running || !this.ollamaPath) {
            return;
        }

        console.log(`[LLM] Starting Ollama...`);

        // Check if Ollama is already running
        try {
            const response = await fetch(`http://localhost:${this.port}/api/tags`);
            if (response.ok) {
                console.log('[LLM] Ollama already running');
                this.running = true;
                await this.ensureModel();
                return;
            }
        } catch {}

        // Start Ollama serve
        this.process = spawn(this.ollamaPath, ['serve'], {
            env: {
                ...process.env,
                OLLAMA_HOST: `127.0.0.1:${this.port}`,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        this.process.stdout?.on('data', (data) => {
            console.log(`[LLM] ${data.toString().trim()}`);
        });

        this.process.stderr?.on('data', (data) => {
            console.error(`[LLM] ${data.toString().trim()}`);
        });

        this.process.on('exit', (code) => {
            console.log(`[LLM] Ollama exited with code ${code}`);
            this.running = false;
            this.process = null;
        });

        // Wait for server to be ready
        await this.waitForReady();
        this.running = true;

        // Ensure model is pulled
        await this.ensureModel();
    }

    private async waitForReady(maxAttempts = 30): Promise<void> {
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const response = await fetch(`http://localhost:${this.port}/api/tags`);
                if (response.ok) {
                    console.log('[LLM] Ollama ready');
                    return;
                }
            } catch {}
            await new Promise(r => setTimeout(r, 500));
        }
        throw new Error('Ollama failed to start');
    }

    private async ensureModel(): Promise<void> {
        try {
            const response = await fetch(`http://localhost:${this.port}/api/tags`);
            const data = await response.json() as { models?: Array<{ name: string }> };
            const models = data.models || [];

            const hasModel = models.some((m) => m.name.startsWith(this.model));
            if (hasModel) {
                console.log(`[LLM] Model ${this.model} available`);
                return;
            }

            console.log(`[LLM] Pulling model ${this.model}...`);
            await fetch(`http://localhost:${this.port}/api/pull`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: this.model }),
            });
        } catch (e: any) {
            console.error(`[LLM] Failed to ensure model: ${e.message}`);
        }
    }

    async stop(): Promise<void> {
        if (!this.running || !this.process) {
            return;
        }

        console.log('[LLM] Stopping Ollama...');
        this.process.kill();
        this.process = null;
        this.running = false;
    }

    async listModels(): Promise<string[]> {
        try {
            const response = await fetch(`http://localhost:${this.port}/api/tags`);
            const data = await response.json() as { models?: Array<{ name: string }> };
            return (data.models || []).map((m) => m.name);
        } catch {
            return [];
        }
    }

    async pullModel(model: string): Promise<void> {
        console.log(`[LLM] Pulling model ${model}...`);
        await fetch(`http://localhost:${this.port}/api/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: model, stream: false }),
        });
    }
}
