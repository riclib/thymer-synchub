import WebSocket, { WebSocketServer } from 'ws';

// Global instance for HTTP server access
let instance: ThymerBridge | null = null;

export function getThymerBridge(): ThymerBridge | null {
    return instance;
}

interface Tool {
    name: string;
    description: string;
    parameters?: Record<string, any>;
}

interface PendingCall {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}

/**
 * WebSocket Server that SyncHub connects TO
 *
 * SyncHub (browser plugin) initiates the connection to us.
 * This allows:
 * - SyncHub to push tool registrations
 * - Desktop to request tool executions
 * - Desktop to trigger syncs
 */
export class ThymerBridge {
    private wss: WebSocketServer | null = null;
    private client: WebSocket | null = null; // The connected SyncHub client
    private pendingCalls = new Map<string, PendingCall>();
    private callId = 0;
    private tools: Tool[] = [];
    private plugins: Array<{ name: string; enabled: boolean }> = [];

    private port = 9848;

    constructor() {
        instance = this;
        this.startServer();
    }

    private startServer() {
        this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' });

        console.log(`[Bridge] WebSocket server listening on ws://127.0.0.1:${this.port}`);

        this.wss.on('connection', (ws) => {
            console.log('[Bridge] SyncHub connected');

            // Only allow one client (the browser)
            if (this.client) {
                console.log('[Bridge] Closing previous connection');
                this.client.close();
            }
            this.client = ws;

            ws.on('message', (data) => {
                this.handleMessage(data.toString());
            });

            ws.on('close', () => {
                console.log('[Bridge] SyncHub disconnected');
                if (this.client === ws) {
                    this.client = null;
                    this.tools = [];
                    this.plugins = [];
                }
            });

            ws.on('error', (err) => {
                console.error('[Bridge] WebSocket error:', err.message);
            });

            // Request initial state
            this.send({ type: 'get_tools' });
            this.send({ type: 'get_plugins' });
        });

        this.wss.on('error', (err) => {
            console.error('[Bridge] Server error:', err.message);
        });
    }

    disconnect() {
        this.client?.close();
        this.client = null;
        this.wss?.close();
        this.wss = null;
        instance = null;
    }

    reconnect() {
        // Restart the server (client will auto-reconnect)
        this.disconnect();
        instance = this;
        this.startServer();
    }

    isConnected(): boolean {
        return this.client !== null && this.client.readyState === WebSocket.OPEN;
    }

    getPlugins() {
        return this.plugins;
    }

    private handleMessage(data: string) {
        try {
            const msg = JSON.parse(data);

            // Handle responses to our calls
            if (msg.id && this.pendingCalls.has(msg.id)) {
                const pending = this.pendingCalls.get(msg.id)!;
                this.pendingCalls.delete(msg.id);
                clearTimeout(pending.timeout);

                if (msg.error) {
                    pending.reject(new Error(msg.error));
                } else {
                    pending.resolve(msg.result);
                }
                return;
            }

            // Handle push messages FROM SyncHub
            switch (msg.type) {
                case 'tools':
                    // SyncHub pushes its registered tools
                    this.tools = msg.tools || [];
                    console.log(`[Bridge] Received ${this.tools.length} tools from SyncHub`);
                    break;

                case 'plugins':
                    // SyncHub pushes plugin list
                    this.plugins = msg.plugins || [];
                    console.log(`[Bridge] Received ${this.plugins.length} plugins from SyncHub`);
                    break;

                case 'sync_complete':
                    console.log(`[Bridge] Sync complete: ${msg.plugin}`);
                    break;

                case 'register':
                    // SyncHub announces itself
                    console.log(`[Bridge] SyncHub registered: ${msg.version || 'unknown'}`);
                    break;
            }
        } catch (e) {
            console.error('[Bridge] Failed to parse message:', e);
        }
    }

    private send(msg: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.client || this.client.readyState !== WebSocket.OPEN) {
                reject(new Error('SyncHub not connected'));
                return;
            }

            const id = `call_${++this.callId}`;
            msg.id = id;

            const timeout = setTimeout(() => {
                this.pendingCalls.delete(id);
                reject(new Error('Call timed out'));
            }, 30000);

            this.pendingCalls.set(id, { resolve, reject, timeout });

            this.client.send(JSON.stringify(msg));
        });
    }

    // ========================================================================
    // Public API (called by HTTP server)
    // ========================================================================

    async getTools(): Promise<Tool[]> {
        if (this.tools.length === 0 && this.isConnected()) {
            try {
                const tools = await this.send({ type: 'get_tools' });
                this.tools = tools || [];
            } catch {}
        }
        return this.tools;
    }

    async executeToolCall(name: string, args: Record<string, any>): Promise<any> {
        return this.send({
            type: 'tool_call',
            name,
            args,
        });
    }

    async sync(pluginId: string): Promise<void> {
        await this.send({
            type: 'sync',
            plugin: pluginId,
        });
    }

    async syncAll(): Promise<void> {
        await this.send({
            type: 'sync_all',
        });
    }
}
