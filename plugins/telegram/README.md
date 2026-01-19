# Telegram Sync Plugin

Send messages to your personal Telegram bot, and they appear in Thymer - automatically routed with task creation, date parsing, and hashtag support.

## Setup

### 1. Create Your Bot
1. Open Telegram and message [@BotFather](https://t.me/botfather)
2. Send `/newbot`
3. Follow the prompts to name your bot
4. Copy the bot token (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Configure in Sync Hub

| Field | Value |
|-------|-------|
| Plugin ID | `telegram-sync` |
| Enabled | Yes |
| Interval | 1 minute (default) |
| Token | Your bot token from BotFather |

## Smart Routing

Messages are automatically routed based on content:

| You Send | Destination |
|----------|-------------|
| `Quick thought` | Journal: **14:30** Quick thought |
| `[] Buy groceries` | Journal: ☐ Buy groceries |
| `[] Call dentist @tomorrow` | Journal: ☐ Call dentist Mon Jan 19 |
| `[] Fix bug @important` | Journal: ⚠ Fix bug |
| Multi-line text | Journal with indented and bulleted children |
| `# Markdown heading` | Captures collection (with Journal ref) |
| `https://article.com` | Captures collection (URL stored) |
| `github.com/user/repo/issues/42` | Journal (future: Issues collection) |
| Photo + caption | Journal: **14:30** [Photo] caption |

## Task Creation

Lines starting with `[]` or `TASK` create checkbox tasks:

```
[] Buy groceries
[] Call dentist
[] Review PR
```

**Result:** Three separate tasks in your Journal (no timestamps, no bullets).

### Task Features

- **@important** - Marks task as important
- **Date parsing** - Automatically extracts dates
- **Sub-items** - Lines after a task become bulleted children

## Date Parsing

Dates are automatically detected and added as Thymer date segments:

| Format | Example |
|--------|---------|
| Relative | `@tomorrow`, `@today` |
| Named months | `Jan 15`, `@February 28` |
| ISO | `2026-01-15` |
| Slash | `15/01`, `01/15` |

Dates work on all lines - tasks, regular text, and bullet points.

## Hashtags

Hashtags are clickable, searchable tags:

## Multi-line Messages

### Regular Notes
```
First line
Second line
Third line
```

**Result:**
- **14:30** First line
  - Second line
  - Third line

### Tasks with Notes
```
[] Main task
Detail one
Detail two
```

**Result:**
☐ Main task
  - Detail one
  - Detail two

### Markdown Documents

Messages starting with `#` are saved to Captures:

```
# Meeting Notes
## Attendees
- Alice
- Bob
```

## How It Works

```
Phone → Telegram Bot → [messages queue - stored 24h]
                              ↓
                    Sync Hub polls getUpdates
                              ↓
                    Smart routing → Journal / Captures / Issues
```

No server needed! Telegram stores messages for 24 hours. The plugin polls when Thymer is open.

## Configuration

| Field | Required | Description |
|-------|----------|-------------|
| `token` | Yes | Bot token from BotFather |
| `config` | Auto | `{"last_offset": 12345}` - tracks processed messages |

The `last_offset` is automatically updated after each sync.

## Command Palette

- **Telegram Sync** - Poll for new messages

## Troubleshooting

### "Not configured"
Make sure the Token field has your bot token from BotFather.

### Messages not appearing
- Check the bot token is correct
- Try sending a test message to your bot
- Check Sync Hub logs for errors

### Duplicate messages
The `last_offset` tracks processed messages. If corrupted, you might see duplicates. Fix by removing `last_offset` from config.

### "No sync function for: telegram-sync"
The Sync Hub record exists but the plugin's sync function isn't registered. Check:
1. **Plugin enabled?** Go to Plugins panel → ensure Telegram is enabled (not just installed)
2. **Check console for registration:**
   ```
   [SyncHub] Registered plugin: telegram-sync (N total)
   ```
   If missing, the plugin never registered.
3. **Check load order:** Look for these messages in order:
   ```
   [SyncHub] Ready, dispatching synchub-ready event
   [SyncHub] Registered plugin: telegram-sync
   ```
4. **JavaScript errors?** Red errors during load prevent registration.
5. **Force re-registration:** In console:
   ```javascript
   window.dispatchEvent(new CustomEvent('synchub-ready'))
   ```
6. **Reload the plugin:** Disable → wait → re-enable
7. **Orphaned record?** If plugin was uninstalled, delete the "Telegram" record from Sync Hub collection, then reinstall.

## Version

Current version: v1.3.0

## Future Features

- [ ] Web URL fetching with readability extraction
- [ ] GitHub issue/PR detection → Issues collection
- [ ] iCal link parsing → Calendar collection
- [ ] Photo storage → Captures with embedded image
- [ ] Voice message transcription
- [ ] Two-way: notifications from Thymer → Telegram
