# vidalytics-mcp

One-command setup that connects your AI coding assistant to Vidalytics video analytics data via the [Model Context Protocol](https://modelcontextprotocol.io).

Works with Claude (CLI & Desktop), Windsurf, Cursor, and any other MCP-compatible client.

## Setup

```bash
npx vidalytics-mcp install
```

That's it. The installer detects which AI clients you have installed and configures each one automatically. Restart the client — a browser window will open for OAuth authorization on first use.

## What it does

- Detects installed MCP clients (Claude CLI, Claude Desktop, Windsurf, Cursor) by checking config files, app directories, binaries in `$PATH`, and app bundles in `/Applications`
- Adds Vidalytics as an MCP server in each detected client's config
- Shows a preview of changes and asks for confirmation before writing anything

## Available tools

Once connected, your AI assistant gains access to:

| Tool | Description |
|------|-------------|
| `list_videos` | List videos with pagination |
| `get_video` | Get video details |
| `get_video_stats` | Views, play rate, watch time, conversions |
| `get_video_dropoff` | Audience retention by percentage |
| `get_video_percentage_watched` | % of viewers who reached each point |
| `get_videos_stats_batch` | Stats for up to 30 videos at once |
| `get_videos_timeline` | Timeline stats for up to 5 videos |
| `list_folders` | List video folders |
| `list_settings_templates` | List settings templates |
| `get_video_ctas` | Get CTAs for a video |
| `get_video_pause_screens` | Get pause screens for a video |

## Options

```
npx vidalytics-mcp install --all                    Configure all known clients, even if not detected
npx vidalytics-mcp install --config /path/to/mcp.json   Also configure a custom config file
npx vidalytics-mcp install --force                  Re-apply even if already configured
npx vidalytics-mcp install --yes                    Skip confirmation prompt
```

The `--config` flag can be repeated for multiple files. The target file must follow the `{ "mcpServers": {} }` format used by Claude Desktop, Cursor, and Windsurf — useful for unsupported clients like Zed or VS Code with an MCP plugin.

## Requirements

- Node.js 18+
- A Vidalytics account

## License

[MIT](LICENSE)
