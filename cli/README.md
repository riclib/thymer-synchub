# Thymer CLI

Command-line interface for Thymer. Connects to Thymer Desktop for CORS-free access to your data.

## Installation

```bash
# Build from source
cd cli
go build -o thymer .

# Move to PATH
sudo mv thymer /usr/local/bin/

# Or install directly
go install github.com/anthropics/thymer-synchub/cli@latest
```

## Commands

### Query Collections

```bash
# List open issues
thymer query issues --state=open

# Filter by repo
thymer query issues --repo=anthropics/claude-code --limit=10

# Output as JSON (for scripting)
thymer query issues --state=open --json
```

### Trigger Syncs

```bash
# Sync specific plugin
thymer sync github

# Sync all plugins
thymer sync --all
```

### Quick Capture

```bash
# Capture a note
thymer capture "Remember to check the logs"

# Capture from clipboard (Wayland)
thymer capture "$(wl-paste)"

# Pipe content
echo "Some content" | thymer capture -

# With tags
thymer capture --tags=work,urgent "Important note"
```

### Status

```bash
# Check connection status
thymer status

# JSON output
thymer status --json
```

### MCP Management

```bash
# Install MCP config for Claude Desktop
thymer mcp install

# Check MCP status
thymer mcp status

# List available tools
thymer mcp tools
```

## Wayland Keybindings

Example Sway/Hyprland bindings:

```
# ~/.config/sway/config
bindsym $mod+Shift+c exec thymer capture "$(wl-paste)"
bindsym $mod+Shift+s exec thymer sync --all && notify-send "Thymer" "Sync complete"
bindsym $mod+Shift+i exec foot -e thymer query issues --state=open
```

```
# ~/.config/hyprland/hyprland.conf
bind = $mod SHIFT, C, exec, thymer capture "$(wl-paste)"
bind = $mod SHIFT, S, exec, thymer sync --all && notify-send "Thymer" "Sync complete"
```

## Use with Claude Code

The CLI can be used as part of a Claude Code skill:

```bash
# Get context about open issues
thymer query issues --state=open --json | jq '.[] | {title, guid}'

# Search for specific issues
thymer query issues --repo=myorg/myrepo --state=open --json
```

## Configuration

The CLI connects to Thymer Desktop on `http://localhost:9847` by default.

```bash
# Use different server
thymer --server=http://localhost:9999 status

# Set via environment
export THYMER_SERVER=http://localhost:9999
```

## JSON Output

All commands support `--json` for machine-readable output:

```bash
thymer query issues --json | jq '.[0]'
thymer status --json | jq '.thymer_connected'
thymer mcp tools --json | jq '.[].name'
```
