import express, { Request, Response } from 'express';
import * as http from 'http';
import { getThymerBridge } from './thymer-bridge';

let server: http.Server | null = null;
const app = express();

app.use(express.json());

// CORS headers for browser access
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ============================================================================
// Status & Health
// ============================================================================

app.get('/api/status', (req: Request, res: Response) => {
    const bridge = getThymerBridge();
    res.json({
        version: '0.1.0',
        thymer_connected: bridge?.isConnected() ?? false,
        llm: {
            running: false, // TODO: check LLM runtime
            model: null,
        },
        mcp: {
            running: true,
            transport: 'http',
        },
        plugins: bridge?.getPlugins() ?? [],
    });
});

// ============================================================================
// Query API (for CLI)
// ============================================================================

app.get('/api/query', async (req: Request, res: Response) => {
    const bridge = getThymerBridge();
    if (!bridge?.isConnected()) {
        return res.status(503).json({ error: 'Not connected to Thymer' });
    }

    const { collection, state, repo, assignee, limit } = req.query;

    try {
        // Execute query via Thymer bridge
        const toolName = `${collection}_find`;
        const args: Record<string, any> = {};
        if (state) args.state = state;
        if (repo) args.repo = repo;
        if (assignee) args.assignee = assignee;
        if (limit) args.limit = parseInt(limit as string);

        const result = await bridge.executeToolCall(toolName, args);
        res.json(result);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// Sync API (for CLI)
// ============================================================================

app.post('/api/sync', async (req: Request, res: Response) => {
    const bridge = getThymerBridge();
    if (!bridge?.isConnected()) {
        return res.status(503).json({ error: 'Not connected to Thymer' });
    }

    const { plugin, all } = req.body;

    try {
        if (all) {
            await bridge.syncAll();
            res.json({ message: 'All syncs triggered' });
        } else if (plugin) {
            await bridge.sync(plugin);
            res.json({ message: `Sync triggered for ${plugin}` });
        } else {
            res.status(400).json({ error: 'Specify plugin or use all: true' });
        }
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// Capture API (for CLI)
// ============================================================================

app.post('/api/capture', async (req: Request, res: Response) => {
    const bridge = getThymerBridge();
    if (!bridge?.isConnected()) {
        return res.status(503).json({ error: 'Not connected to Thymer' });
    }

    const { text, source, tags } = req.body;

    try {
        const result = await bridge.executeToolCall('captures_create', {
            text,
            source: source || 'cli',
            tags,
        });
        res.status(201).json(result);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// MCP API (for CLI and MCP clients)
// ============================================================================

app.get('/api/mcp/status', (req: Request, res: Response) => {
    res.json({
        running: true,
        transport: 'http',
        clients: 0, // TODO: track connected clients
    });
});

app.get('/api/mcp/tools', async (req: Request, res: Response) => {
    const bridge = getThymerBridge();
    if (!bridge?.isConnected()) {
        return res.status(503).json({ error: 'Not connected to Thymer' });
    }

    try {
        const tools = await bridge.getTools();
        res.json(tools);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/mcp/call', async (req: Request, res: Response) => {
    const bridge = getThymerBridge();
    if (!bridge?.isConnected()) {
        return res.status(503).json({ error: 'Not connected to Thymer' });
    }

    const { name, args } = req.body;

    try {
        const result = await bridge.executeToolCall(name, args || {});
        res.json(result);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// LLM Proxy (CORS-free for browser)
// ============================================================================

app.post('/api/llm/chat', async (req: Request, res: Response) => {
    // Proxy to local LLM (Ollama or bundled)
    const { model, messages, stream } = req.body;

    try {
        // Forward to Ollama
        const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
        const response = await fetch(`${ollamaUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, stream: stream ?? true }),
        });

        if (stream !== false) {
            // Stream response
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(decoder.decode(value));
            }
            res.end();
        } else {
            const data = await response.json();
            res.json(data);
        }
    } catch (e: any) {
        res.status(502).json({ error: `LLM proxy error: ${e.message}` });
    }
});

// OpenAI-compatible endpoint (for AgentHub custom provider)
app.post('/v1/chat/completions', async (req: Request, res: Response) => {
    const { model, messages, stream, max_tokens } = req.body;

    try {
        const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';

        // Convert OpenAI format to Ollama format
        const ollamaBody = {
            model: model || 'qwen2.5:7b',
            messages,
            stream: stream ?? true,
            options: {
                num_predict: max_tokens || 4096,
            },
        };

        const response = await fetch(`${ollamaUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ollamaBody),
        });

        if (stream !== false) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    res.write('data: [DONE]\n\n');
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const ollamaChunk = JSON.parse(line);
                        // Convert to OpenAI SSE format
                        const openaiChunk = {
                            id: 'chatcmpl-local',
                            object: 'chat.completion.chunk',
                            created: Date.now(),
                            model: ollamaChunk.model,
                            choices: [{
                                index: 0,
                                delta: {
                                    content: ollamaChunk.message?.content || '',
                                },
                                finish_reason: ollamaChunk.done ? 'stop' : null,
                            }],
                        };
                        res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                    } catch {}
                }
            }
            res.end();
        } else {
            const ollamaData = await response.json() as {
                model: string;
                message: { role: string; content: string };
                prompt_eval_count?: number;
                eval_count?: number;
            };
            // Convert to OpenAI format
            res.json({
                id: 'chatcmpl-local',
                object: 'chat.completion',
                created: Date.now(),
                model: ollamaData.model,
                choices: [{
                    index: 0,
                    message: ollamaData.message,
                    finish_reason: 'stop',
                }],
                usage: {
                    prompt_tokens: ollamaData.prompt_eval_count || 0,
                    completion_tokens: ollamaData.eval_count || 0,
                    total_tokens: (ollamaData.prompt_eval_count || 0) + (ollamaData.eval_count || 0),
                },
            });
        }
    } catch (e: any) {
        res.status(502).json({ error: { message: `LLM proxy error: ${e.message}` } });
    }
});

// ============================================================================
// Server Lifecycle
// ============================================================================

export function startHttpServer(port: number): Promise<void> {
    return new Promise((resolve) => {
        server = app.listen(port, '127.0.0.1', () => {
            console.log(`[HTTP] Server listening on http://127.0.0.1:${port}`);
            resolve();
        });
    });
}

export function stopHttpServer(): void {
    server?.close();
    server = null;
}
