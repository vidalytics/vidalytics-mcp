#!/usr/bin/env node
'use strict';

const command = process.argv[2];

if (command === 'install') {
  // run() is async (interactive checklist + reachability probe); surface any
  // failure the same way the old synchronous try/catch did.
  require('../lib/installer').run().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else {
  console.log('Usage:');
  console.log('  npx @vidalytics/mcp install                     pick clients to configure (interactive)');
  console.log('  npx @vidalytics/mcp install --client <names>    configure only these (e.g. cursor,windsurf)');
  console.log('  npx @vidalytics/mcp install --all               configure all known clients');
  console.log('  npx @vidalytics/mcp install --config <path>     also configure a custom config file');
  console.log('  npx @vidalytics/mcp install --force             re-apply even if already configured');
  console.log('  npx @vidalytics/mcp install --yes               skip prompts (configure detected)');
  console.log('');
  console.log('  client names: claude-cli, claude-desktop, windsurf, cursor');
  process.exit(command ? 1 : 0);
}
