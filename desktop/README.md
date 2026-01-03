# Thymer Desktop

System tray app that bridges Thymer to CLI tools and MCP clients.

Written in Go with fyne.io/systray for cross-platform tray support.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  thymer-desktop (Go binary, ~15MB)                              │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  System Tray                                                ││
│  │  ├── Status: ● Connected (18 tools)                         ││
│  │  ├── Open Thymer                                            ││
│  │  ├── Sync All                                               ││
│  │  ├── Settings                                               ││
│  │  └── Quit                                                   ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  WebSocket Server (:9848)                                 │  │
│  │  ◄── SyncHub (browser) connects here                      │  │
│  │  ◄── Pushes tools, receives commands                      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  HTTP API (:9847)                                         │  │
│  │  ◄── CLI and MCP clients connect here                     │  │
│  │                                                           │  │
│  │  GET  /api/status     Connection status                   │  │
│  │  GET  /api/query      Query collections                   │  │
│  │  POST /api/sync       Trigger plugin syncs                │  │
│  │  POST /api/capture    Quick capture to journal            │  │
│  │  GET  /api/mcp/tools  List available tools                │  │
│  │  POST /api/mcp/call   Execute a tool                      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Build

```bash
# Build
cd desktop
go build -o thymer-desktop .

# Or use Makefile from repo root
make desktop
```

## Run

```bash
# With system tray
./thymer-desktop

# Headless (no tray, just servers)
./thymer-desktop --headless

# Custom ports
./thymer-desktop --http=8080 --ws=8081
```

## Configuration

Config is stored in `~/.config/thymer-desktop/config.json`:

```json
{
  "workspace": "myworkspace.thymer.com"
}
```

## How It Works

1. **thymer-desktop** starts and listens on WebSocket port 9848
2. User opens Thymer in browser with SyncHub plugin
3. SyncHub connects to `ws://127.0.0.1:9848`
4. SyncHub pushes available tools (from collection plugins)
5. CLI/MCP clients can now query collections, trigger syncs, etc.

## Use with CLI

```bash
# Check status
thymer status

# Query issues
thymer query issues --state=open

# Trigger sync
thymer sync github

# Quick capture
thymer capture "Remember to check the logs"
```

## Use with Claude Desktop (MCP)

```bash
# Install MCP config
thymer mcp install

# Restart Claude Desktop
# Claude can now use Thymer tools
```
