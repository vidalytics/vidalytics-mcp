'use strict';

const readline = require('readline');
const { preview, applyChanges } = require('./clients');

exports.run = function () {
  const argv = process.argv.slice(3);
  const force      = argv.includes('--force');
  const yes        = argv.includes('--yes');
  const includeAll = argv.includes('--all');

  const customPaths = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      customPaths.push(argv[++i]);
    }
  }

  const items      = preview({ force, includeAll, customPaths });
  const actionable = items.filter(i => i.action === 'install' || i.action === 'update');
  const skipped    = items.filter(i => i.action === 'skipped');
  const unchanged  = items.filter(i => i.action === 'no-change');
  const errored    = items.filter(i => i.action === 'error');

  console.log('');

  if (actionable.length > 0) {
    console.log('Changes to apply:');
    for (const item of actionable) {
      const label = item.action === 'update' ? 'UPDATE' : 'ADD';
      console.log(`  ${label.padEnd(6)}  ${item.name.padEnd(16)}  ${item.cfgPath}`);
    }
  }

  if (errored.length > 0) {
    if (actionable.length > 0) console.log('');
    console.log('Could not parse existing config (left untouched):');
    for (const item of errored) {
      console.log(`  ${item.name.padEnd(16)}  ${item.cfgPath}`);
      console.log(`      ${item.error}`);
    }
    console.log('  → fix or remove the file, then re-run.');
  }

  if (skipped.length > 0) {
    if (actionable.length > 0 || errored.length > 0) console.log('');
    console.log('Not detected (skipped):');
    for (const item of skipped) {
      console.log(`  ${item.name}`);
    }
    console.log('  → use --all to configure them anyway');
  }

  if (unchanged.length > 0) {
    if (actionable.length > 0 || errored.length > 0 || skipped.length > 0) console.log('');
    console.log(`Already up to date: ${unchanged.map(i => i.name).join(', ')}`);
  }

  if (actionable.length === 0) {
    if (unchanged.length > 0 && skipped.length === 0 && errored.length === 0) {
      console.log('Run with --force to re-apply.');
    }
    if (errored.length > 0) process.exitCode = 1;
    console.log('');
    return;
  }

  console.log('');

  if (yes) {
    doApply(items);
  } else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Apply changes? [Y/n] ', (answer) => {
      rl.close();
      if (!answer || answer.toLowerCase() === 'y') {
        doApply(items);
      } else {
        console.log('Aborted.');
        console.log('');
      }
    });
  }
};

function doApply(items) {
  const applied = applyChanges(items);
  const failed = applied.filter(r => !r.ok);

  if (failed.length > 0) {
    console.log('Some files could not be written:');
    for (const r of failed) {
      console.log(`  ${r.name.padEnd(16)}  ${r.error}`);
    }
    console.log('');
    process.exitCode = 1;
  }

  if (applied.some(r => r.ok)) {
    console.log('Done. Next steps:');
    console.log('  1. Restart the configured client(s)');
    console.log('  2. On first use, a browser window will open for OAuth authorization');
  }
  console.log('');
}
