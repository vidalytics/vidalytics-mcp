'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  preview, applyChanges, makeMcpEntry, readCfg, getAction,
} = require('../lib/clients');

// Fresh temp directory per call — tests never touch the real $HOME configs.
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vidmcp-'));
}

// Build an actionable item that applyChanges() will process, pointed at a temp file.
function item(cfgPath, action = 'install') {
  return { name: path.basename(cfgPath), cfgPath, action, custom: true };
}

test('getAction: install / no-change / update / force', () => {
  const entry = makeMcpEntry();
  assert.equal(getAction(null, entry, false), 'install');
  assert.equal(getAction(entry, entry, false), 'no-change');
  assert.equal(getAction({ command: 'other' }, entry, false), 'update');
  // --force re-applies even when identical.
  assert.equal(getAction(entry, entry, true), 'update');
});

test('readCfg distinguishes missing / empty / valid / malformed', () => {
  const dir = tmpDir();
  const missing = path.join(dir, 'missing.json');
  assert.deepEqual(readCfg(missing), { data: {}, exists: false, parseError: null });

  const empty = path.join(dir, 'empty.json');
  fs.writeFileSync(empty, '   \n');
  const e = readCfg(empty);
  assert.equal(e.exists, true);
  assert.equal(e.parseError, null);
  assert.deepEqual(e.data, {});

  const valid = path.join(dir, 'valid.json');
  fs.writeFileSync(valid, JSON.stringify({ mcpServers: { foo: { command: 'x' } } }));
  const v = readCfg(valid);
  assert.equal(v.parseError, null);
  assert.deepEqual(v.data.mcpServers.foo, { command: 'x' });

  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{ "mcpServers": { , }');
  const b = readCfg(bad);
  assert.equal(b.exists, true);
  assert.ok(b.parseError instanceof Error);
  assert.deepEqual(b.data, {});
});

test('applyChanges merges into an existing config without dropping other keys', () => {
  const dir = tmpDir();
  const cfgPath = path.join(dir, 'mcp.json');
  fs.writeFileSync(cfgPath, JSON.stringify({
    mcpServers: { foo: { command: 'foo-cmd' } },
    otherTopLevel: 42,
  }, null, 2));

  const result = applyChanges([item(cfgPath)]);
  assert.equal(result[0].ok, true);

  const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.equal(after.otherTopLevel, 42, 'unrelated top-level key preserved');
  assert.deepEqual(after.mcpServers.foo, { command: 'foo-cmd' }, 'other server preserved');
  assert.deepEqual(after.mcpServers.vidalytics, makeMcpEntry(), 'vidalytics added');
});

test('applyChanges creates a fresh config when the file is missing', () => {
  const dir = tmpDir();
  const cfgPath = path.join(dir, 'nested', 'mcp.json'); // dir does not exist yet
  const result = applyChanges([item(cfgPath)]);
  assert.equal(result[0].ok, true);
  const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.deepEqual(after.mcpServers.vidalytics, makeMcpEntry());
});

test('H1 regression: a malformed existing config is NEVER overwritten', () => {
  const dir = tmpDir();
  const cfgPath = path.join(dir, 'broken.json');
  const original = '{ "mcpServers": { "foo": }, trailing,, }';
  fs.writeFileSync(cfgPath, original);

  // Even if a caller passes an actionable item, applyChanges must refuse to write.
  const result = applyChanges([item(cfgPath)]);
  assert.equal(result[0].ok, false);
  assert.ok(result[0].error);

  assert.equal(fs.readFileSync(cfgPath, 'utf8'), original, 'file left byte-for-byte intact');
  assert.equal(fs.existsSync(cfgPath + '.bak'), false, 'no backup written for an untouched file');
});

test('H2: existing config is backed up and no temp file is left behind', () => {
  const dir = tmpDir();
  const cfgPath = path.join(dir, 'mcp.json');
  const original = JSON.stringify({ mcpServers: {} }, null, 2);
  fs.writeFileSync(cfgPath, original);

  applyChanges([item(cfgPath)]);

  assert.equal(fs.existsSync(cfgPath + '.bak'), true, 'backup created');
  assert.equal(fs.readFileSync(cfgPath + '.bak', 'utf8'), original, 'backup holds previous content');
  assert.equal(fs.existsSync(cfgPath + '.tmp'), false, 'temp file removed after atomic rename');
});

test('VIDALYTICS_MCP_URL overrides the server URL (https only)', () => {
  const prev = process.env.VIDALYTICS_MCP_URL;
  try {
    // default → production
    delete process.env.VIDALYTICS_MCP_URL;
    assert.match(makeMcpEntry().args.join(' '), /api\.vidalytics\.com/);

    // valid https override is honored
    process.env.VIDALYTICS_MCP_URL = 'https://api.example.test/mcp';
    assert.match(makeMcpEntry().args.join(' '), /api\.example\.test\/mcp/);

    // non-https override is rejected
    process.env.VIDALYTICS_MCP_URL = 'http://insecure.test/mcp';
    assert.throws(() => makeMcpEntry(), /https/);
  } finally {
    if (prev === undefined) delete process.env.VIDALYTICS_MCP_URL;
    else process.env.VIDALYTICS_MCP_URL = prev;
  }
});

test('preview on a custom path: install / no-change / error', () => {
  const dir = tmpDir();

  // missing → install
  const missing = path.join(dir, 'a.json');
  let res = preview({ customPaths: [missing] }).find(r => r.custom);
  assert.equal(res.action, 'install');

  // already configured → no-change
  const configured = path.join(dir, 'b.json');
  fs.writeFileSync(configured, JSON.stringify({ mcpServers: { vidalytics: makeMcpEntry(false) } }));
  res = preview({ customPaths: [configured] }).find(r => r.custom);
  assert.equal(res.action, 'no-change');

  // malformed → error (so it is shown as untouchable, not a safe ADD)
  const broken = path.join(dir, 'c.json');
  fs.writeFileSync(broken, '{ not json');
  res = preview({ customPaths: [broken] }).find(r => r.custom);
  assert.equal(res.action, 'error');
  assert.ok(res.error);
});
