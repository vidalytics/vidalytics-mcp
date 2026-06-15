#!/usr/bin/env node
'use strict';

const command = process.argv[2];

if (command === 'install') {
  try {
    require('../lib/installer').run();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
} else {
  console.log('Usage:');
  console.log('  npx vidalytics-mcp install                     configure detected MCP clients');
  console.log('  npx vidalytics-mcp install --all               configure all known clients');
  console.log('  npx vidalytics-mcp install --config <path>     also configure a custom config file');
  console.log('  npx vidalytics-mcp install --force             re-apply even if already configured');
  console.log('  npx vidalytics-mcp install --yes               skip confirmation prompt');
  process.exit(command ? 1 : 0);
}
