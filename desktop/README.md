# Thymer Desktop

Electron app that provides local services for Thymer:

- **MCP Bridge** - Expose Thymer tools to Claude Desktop, Cursor, etc.
- **CORS Proxy** - Let browser-based SyncHub call local LLMs without CORS issues
- **Local LLM** - Manage and run local models via Ollama

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Thymer Desktop (Electron)                            │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐        │
│  │  MCP Server  │  │  HTTP Proxy  │  │   Local LLM Runtime    │        │
│  │  (for AI     │  │  (CORS-free  │  │   (Ollama manager)     │        │
│  │   clients)   │  │   for browser│  │                        │        │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬─────────────┘        │
│         │                 │                     │                       │
│         └─────────────────┴─────────────────────┘                       │
│                           │                                             │
│              ┌────────────▼────────────┐                               │
│              │   Thymer SDK Bridge     │                               │
│              │   (WebSocket to Thymer) │                               │
│              └─────────────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────┘
         │                    │                      │
         ▼                    ▼                      ▼
   Claude Desktop      Thymer Browser          thymer-cli
   (MCP client)        (uses CORS proxy)       (automation)
```

## Quick Start

```bash
# Install dependencies
cd desktop
npm install

# Run in development
npm run dev

# Build for production
npm run package
```

## HTTP API (Port 9847)

### Status
```bash
GET /api/status
```

### Query Collections
```bash
GET /api/query?collection=issues&state=open&limit=10
```

### Trigger Sync
```bash
POST /api/sync
{"plugin": "github"}
# or
{"all": true}
```

### Quick Capture
```bash
POST /api/capture
{"text": "Note from CLI", "source": "cli"}
```

### MCP Tools
```bash
GET /api/mcp/tools           # List available tools
POST /api/mcp/call           # Execute a tool
{"name": "issues_find", "args": {"state": "open"}}
```

### LLM Proxy (CORS-free)
```bash
# Ollama-style endpoint
POST /api/llm/chat
{"model": "qwen2.5:7b", "messages": [...], "stream": true}

# OpenAI-compatible endpoint (for AgentHub)
POST /v1/chat/completions
{"model": "qwen2.5:7b", "messages": [...], "stream": true}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `THYMER_WS_URL` | `ws://localhost:9848` | Thymer WebSocket endpoint |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API endpoint |

## Using with Claude Desktop

1. Install the CLI: `go install ./cli`
2. Register MCP server: `thymer mcp install`
3. Restart Claude Desktop

Claude can now use Thymer tools:
- "Search my open issues"
- "What's on my calendar today?"
- "Find my recent captures about X"

## System Tray

The app runs in the system tray with:
- Status indicator (connected/disconnected)
- Quick access to start/stop local LLM
- Reconnect to Thymer

## Development

```bash
# Watch mode (auto-rebuild)
npm run dev

# Build TypeScript only
npm run build

# Package for distribution
npm run package
```
