'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const home = os.homedir();
const appdata = process.env.APPDATA || '';

const PROD_URL = 'https://api.vidalytics.com/public/v1/mcp';

// The server URL defaults to production. It can be overridden (e.g. to target a
// non-production environment) via the VIDALYTICS_MCP_URL env var — kept out of the
// source so no internal infrastructure is baked into this public package.
function resolveUrl() {
  const override = process.env.VIDALYTICS_MCP_URL;
  if (!override) return PROD_URL;
  if (!/^https:\/\//i.test(override)) {
    throw new Error(`VIDALYTICS_MCP_URL must be an https:// URL (got: ${override})`);
  }
  return override;
}

// Claude CLI supports native Streamable HTTP; Claude Desktop does not yet —
// it requires an mcp-remote stdio proxy to connect to remote servers.
function makeClaudeCliEntry(url) { return { type: 'http', url }; }
function makeClaudeDesktopEntry(url) {
  return { command: 'npx', args: ['-y', 'mcp-remote@latest', url] };
}
function makeCursorEntry(url) { return { url }; }
function makeWindsurfEntry(url) { return { serverUrl: url }; }

function which(cmd) {
  try {
    // execFileSync (no shell) so `cmd` can never be interpreted as a shell token.
    execFileSync(
      process.platform === 'win32' ? 'where' : 'which',
      [cmd],
      { stdio: 'ignore', timeout: 3000 }
    );
    return true;
  } catch {
    return false;
  }
}

function appExists(name) {
  if (process.platform === 'darwin') {
    return (
      fs.existsSync(path.join('/Applications', `${name}.app`)) ||
      fs.existsSync(path.join(home, 'Applications', `${name}.app`))
    );
  }
  if (process.platform === 'win32') {
    const lad = process.env.LOCALAPPDATA || '';
    const pf  = process.env.ProgramFiles  || 'C:\\Program Files';
    return fs.existsSync(path.join(lad, name)) || fs.existsSync(path.join(pf, name));
  }
  return false;
}

const CLIENTS = [
  {
    name: 'Claude CLI',
    makeEntry: makeClaudeCliEntry,
    configPath: {
      darwin: path.join(home, '.claude.json'),
      linux:  path.join(home, '.claude.json'),
      win32:  path.join(home, '.claude.json'),
    },
    // Config is in $HOME itself, so directory check doesn't work — use binary only.
    binaryNames: ['claude'],
    getServers: (cfg) => { if (!cfg.mcpServers) cfg.mcpServers = {}; return cfg.mcpServers; },
  },
  {
    name: 'Claude Desktop',
    makeEntry: makeClaudeDesktopEntry,
    configPath: {
      darwin: path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      linux:  path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
      win32:  path.join(appdata, 'Claude', 'claude_desktop_config.json'),
    },
    appNames: ['Claude'],
    getServers: (cfg) => { if (!cfg.mcpServers) cfg.mcpServers = {}; return cfg.mcpServers; },
  },
  {
    name: 'Windsurf',
    makeEntry: makeWindsurfEntry,
    configPath: {
      darwin: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      linux:  path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      win32:  path.join(appdata, 'Windsurf', 'mcp_config.json'),
    },
    binaryNames: ['windsurf'],
    appNames: ['Windsurf'],
    getServers: (cfg) => { if (!cfg.mcpServers) cfg.mcpServers = {}; return cfg.mcpServers; },
  },
  {
    name: 'Cursor',
    makeEntry: makeCursorEntry,
    configPath: {
      darwin: path.join(home, '.cursor', 'mcp.json'),
      linux:  path.join(home, '.cursor', 'mcp.json'),
      win32:  path.join(home, '.cursor', 'mcp.json'),
    },
    binaryNames: ['cursor'],
    appNames: ['Cursor'],
    getServers: (cfg) => { if (!cfg.mcpServers) cfg.mcpServers = {}; return cfg.mcpServers; },
  },
];

function getCfgPath(client) {
  return client.configPath[process.platform] || client.configPath.linux;
}

function isClientInstalled(client) {
  const cfgPath = getCfgPath(client);

  // 1. Config file exists — app was used before
  if (fs.existsSync(cfgPath)) return true;

  // 2. Config directory exists (skip $HOME itself — it always exists)
  const cfgDir = path.dirname(cfgPath);
  if (cfgDir !== home && fs.existsSync(cfgDir)) return true;

  // 3. Binary in $PATH
  if (client.binaryNames && client.binaryNames.some(b => which(b))) return true;

  // 4. App bundle in /Applications (macOS) or Program Files (Windows)
  if (client.appNames && client.appNames.some(a => appExists(a))) return true;

  return false;
}

/**
 * Read and parse a config file.
 * Returns { data, exists, parseError }:
 *   - missing file        → { data: {}, exists: false, parseError: null }
 *   - empty/whitespace     → { data: {}, exists: true,  parseError: null }
 *   - valid JSON           → { data: <obj>, exists: true, parseError: null }
 *   - unreadable / bad JSON→ { data: {}, exists: true, parseError: <Error> }
 *
 * The parseError signal is critical: callers MUST NOT overwrite a file that
 * exists but failed to parse, or the user's entire config would be destroyed.
 */
function readCfg(cfgPath) {
  if (!fs.existsSync(cfgPath)) return { data: {}, exists: false, parseError: null };
  let raw;
  try {
    raw = fs.readFileSync(cfgPath, 'utf8');
  } catch (err) {
    return { data: {}, exists: true, parseError: err };
  }
  if (raw.trim() === '') return { data: {}, exists: true, parseError: null };
  try {
    return { data: JSON.parse(raw), exists: true, parseError: null };
  } catch (err) {
    return { data: {}, exists: true, parseError: err };
  }
}

/**
 * Atomically write a config file: write to a sibling temp file, then rename over
 * the target so an interrupted run never leaves a half-written config. An existing
 * non-empty config is backed up to `<path>.bak` first. Files/dirs are created with
 * restrictive permissions (defense in depth — these live in $HOME).
 */
function writeCfgAtomic(cfgPath, cfg) {
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true, mode: 0o700 });

  if (fs.existsSync(cfgPath)) {
    try {
      const prev = fs.readFileSync(cfgPath, 'utf8');
      if (prev.trim() !== '') fs.writeFileSync(cfgPath + '.bak', prev, { mode: 0o600 });
    } catch { /* backup is best-effort — never block the write on it */ }
  }

  const tmp = cfgPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, cfgPath);
}

function getAction(currentEntry, entry, force) {
  if (!currentEntry) return 'install';
  if (!force && JSON.stringify(currentEntry) === JSON.stringify(entry)) return 'no-change';
  return 'update';
}

/**
 * Preview what would change.
 * Returns array of { name, cfgPath, action, entry, currentEntry?, error?, custom? }
 * action: 'install' | 'update' | 'no-change' | 'skipped' | 'error'
 * 'error' means the existing file could not be parsed — it will NOT be touched.
 */
function preview({ force = false, includeAll = false, customPaths = [] } = {}) {
  const url = resolveUrl();
  const results = [];

  for (const client of CLIENTS) {
    const cfgPath = getCfgPath(client);
    const entry = client.makeEntry(url);
    if (!includeAll && !isClientInstalled(client)) {
      results.push({ name: client.name, cfgPath, action: 'skipped' });
      continue;
    }
    const { data: cfg, parseError } = readCfg(cfgPath);
    if (parseError) {
      results.push({ name: client.name, cfgPath, action: 'error', error: parseError.message });
      continue;
    }
    const servers = client.getServers(cfg);
    const currentEntry = servers.vidalytics || null;
    results.push({ name: client.name, cfgPath, action: getAction(currentEntry, entry, force), currentEntry, entry });
  }

  for (const rawPath of customPaths) {
    const cfgPath = path.resolve(rawPath);
    // If the custom path matches a known client's config, use that client's entry
    // format so --config ~/.codeium/windsurf/mcp_config.json gets { serverUrl }
    // instead of { type, url }. Fall back to Claude HTTP for unrecognised paths.
    const matchedClient = CLIENTS.find(c => getCfgPath(c) === cfgPath);
    const entry = matchedClient ? matchedClient.makeEntry(url) : makeClaudeCliEntry(url);
    const { data: cfg, parseError } = readCfg(cfgPath);
    if (parseError) {
      results.push({ name: path.basename(cfgPath), cfgPath, action: 'error', error: parseError.message, custom: true });
      continue;
    }
    const currentEntry = (cfg.mcpServers && cfg.mcpServers.vidalytics) || null;
    results.push({
      name: path.basename(cfgPath),
      cfgPath,
      action: getAction(currentEntry, entry, force),
      currentEntry,
      entry,
      custom: true,
    });
  }

  return results;
}

/**
 * Write config changes for all actionable items from preview().
 * Returns array of { name, cfgPath, ok, error? } describing what was applied.
 */
function applyChanges(items) {
  const applied = [];

  for (const item of items) {
    if (item.action === 'skipped' || item.action === 'no-change' || item.action === 'error') continue;

    // Re-read fresh and bail out if the file no longer parses — never clobber a
    // config we cannot safely merge into (it could have changed since preview()).
    const { data: cfg, parseError } = readCfg(item.cfgPath);
    if (parseError) {
      applied.push({ name: item.name, cfgPath: item.cfgPath, ok: false, error: parseError.message });
      continue;
    }

    // Use the entry computed at preview() time; fall back to Claude HTTP format for
    // items constructed outside of preview() (e.g. test helpers or --config paths).
    const entry = item.entry || makeClaudeEntry(resolveUrl());

    if (!cfg.mcpServers) cfg.mcpServers = {};
    cfg.mcpServers.vidalytics = entry;

    try {
      writeCfgAtomic(item.cfgPath, cfg);
      applied.push({ name: item.name, cfgPath: item.cfgPath, ok: true });
    } catch (err) {
      applied.push({ name: item.name, cfgPath: item.cfgPath, ok: false, error: err.message });
    }
  }

  return applied;
}

module.exports = {
  preview, applyChanges, readCfg, getAction,
  makeClaudeCliEntry, makeClaudeDesktopEntry, makeCursorEntry, makeWindsurfEntry, resolveUrl,
  PROD_URL, CLIENTS, isClientInstalled,
};
