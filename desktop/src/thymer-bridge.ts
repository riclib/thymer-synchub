import WebSocket from 'ws';

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
 * Bridge to Thymer via WebSocket
 *
 * Thymer exposes a WebSocket endpoint for plugins to connect externally.
 * This allows the desktop app to:
 * - Execute tool calls (query collections, trigger syncs)
 * - Get registered tools list
 * - Receive real-time updates
 */
export class ThymerBridge {
    private ws: WebSocket | null = null;
    private connected = false;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private pendingCalls = new Map<string, PendingCall>();
    private callId = 0;
    private tools: Tool[] = [];
    private plugins: Array<{ name: string; enabled: boolean }> = [];

    // Thymer WebSocket URL (configurable)
    private wsUrl = process.env.THYMER_WS_URL || 'ws://localhost:9848';

    constructor() {
        instance = this;
        this.connect();
    }

    connect() {
        if (this.ws) {
            this.ws.close();
        }

        console.log(`[Bridge] Connecting to Thymer at ${this.wsUrl}`);

        try {
            this.ws = new WebSocket(this.wsUrl);

            this.ws.on('open', () => {
                console.log('[Bridge] Connected to Thymer');
                this.connected = true;
                this.requestTools();
                this.requestPlugins();
            });

            this.ws.on('message', (data) => {
                this.handleMessage(data.toString());
            });

            this.ws.on('close', () => {
                console.log('[Bridge] Disconnected from Thymer');
                this.connected = false;
                this.scheduleReconnect();
            });

            this.ws.on('error', (err) => {
                console.error('[Bridge] WebSocket error:', err.message);
                this.connected = false;
            });
        } catch (e: any) {
            console.error('[Bridge] Failed to connect:', e.message);
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect() {
        if (this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, 5000);
    }

    reconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.connect();
    }

    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.ws?.close();
        this.ws = null;
        this.connected = false;
        instance = null;
    }

    isConnected(): boolean {
        return this.connected;
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

            // Handle push messages
            switch (msg.type) {
                case 'tools':
                    this.tools = msg.tools || [];
                    console.log(`[Bridge] Received ${this.tools.length} tools`);
                    break;

                case 'plugins':
                    this.plugins = msg.plugins || [];
                    console.log(`[Bridge] Received ${this.plugins.length} plugins`);
                    break;

                case 'sync_complete':
                    console.log(`[Bridge] Sync complete: ${msg.plugin}`);
                    break;
            }
        } catch (e) {
            console.error('[Bridge] Failed to parse message:', e);
        }
    }

    private send(msg: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.ws || !this.connected) {
                reject(new Error('Not connected to Thymer'));
                return;
            }

            const id = `call_${++this.callId}`;
            msg.id = id;

            const timeout = setTimeout(() => {
                this.pendingCalls.delete(id);
                reject(new Error('Call timed out'));
            }, 30000);

            this.pendingCalls.set(id, { resolve, reject, timeout });

            this.ws.send(JSON.stringify(msg));
        });
    }

    private requestTools() {
        this.send({ type: 'get_tools' }).then((tools) => {
            this.tools = tools || [];
        }).catch(() => {});
    }

    private requestPlugins() {
        this.send({ type: 'get_plugins' }).then((plugins) => {
            this.plugins = plugins || [];
        }).catch(() => {});
    }

    // ========================================================================
    // Public API
    // ========================================================================

    async getTools(): Promise<Tool[]> {
        if (this.tools.length === 0) {
            // Try to fetch fresh
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
