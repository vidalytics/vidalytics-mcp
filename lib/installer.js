'use strict';

const readline = require('readline');
const { preview, applyChanges, verifyWritten, verifyUrl, resolveUrl, CLIENTS } = require('./clients');
const { checkbox } = require('./prompt');

const VALID_KEYS = CLIENTS.map((c) => c.key);

exports.run = async function () {
  const argv = process.argv.slice(3);
  const force      = argv.includes('--force');
  const yes        = argv.includes('--yes');
  const includeAll = argv.includes('--all');

  const customPaths = [];
  const clientFilter = [];
  let clientFlagGiven = false;
  const missingValue = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // Accept both `--flag value` and `--flag=value`. For the space form, only
    // consume the next token as the value when it isn't itself another flag —
    // otherwise the value is treated as missing (`--client --yes`). For the
    // equals form, an empty value (`--client=`) is likewise treated as missing.
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (flag !== '--config' && flag !== '--client') continue;

    let val;
    if (eq !== -1) {
      val = arg.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { val = next; i++; }
    }

    if (flag === '--config') {
      if (!val) { missingValue.push('--config'); continue; }
      customPaths.push(val);
    } else {
      clientFlagGiven = true;
      if (!val) { missingValue.push('--client'); continue; }
      for (const name of val.split(',')) {
        const key = name.trim().toLowerCase();
        if (key) clientFilter.push(key);
      }
    }
  }

  // A flag with no value must fail loudly. Otherwise `--client --yes` would drop
  // the empty filter, stay an "explicit" invocation via --yes, and silently
  // configure EVERY detected client instead of rejecting the malformed option.
  if (missingValue.length > 0) {
    const flags = [...new Set(missingValue)];
    console.log('');
    console.log(`Missing value for: ${flags.join(', ')}`);
    if (flags.includes('--client')) console.log(`  --client expects one or more of: ${VALID_KEYS.join(', ')} (comma-separated)`);
    if (flags.includes('--config')) console.log('  --config expects a path to a config file');
    console.log('');
    process.exitCode = 1;
    return;
  }

  // `--client ,` / `--client ""` parse without error but yield no keys — also reject.
  if (clientFlagGiven && clientFilter.length === 0) {
    console.log('');
    console.log('--client requires at least one client name.');
    console.log(`  valid: ${VALID_KEYS.join(', ')}`);
    console.log('');
    process.exitCode = 1;
    return;
  }

  const unknown = clientFilter.filter((k) => !VALID_KEYS.includes(k));
  if (unknown.length > 0) {
    console.log('');
    console.log(`Unknown --client value(s): ${unknown.join(', ')}`);
    console.log(`  valid: ${VALID_KEYS.join(', ')}`);
    console.log('');
    process.exitCode = 1;
    return;
  }

  const interactive = !!(process.stdin.isTTY && process.stdout.isTTY);

  // Any explicit selection flag (or a non-interactive terminal) skips the checklist
  // and keeps the original flag-driven behavior — never break scripted / CI installs.
  const explicitSelection = includeAll || yes || clientFilter.length > 0;

  if (interactive && !explicitSelection) {
    await runChecklist({ force, customPaths });
    return;
  }

  await runFlags({ force, yes, includeAll, customPaths, clientFilter });
};

// Interactive path: present a checkbox of clients (detected pre-selected) and
// configure only the ones the user keeps checked.
async function runChecklist({ force, customPaths }) {
  const items = preview({ force, includeAll: true, customPaths });
  const errored = items.filter((i) => i.action === 'error');
  const selectable = items.filter((i) => i.action !== 'error');

  console.log('');

  if (selectable.length === 0) {
    printErrored(errored);
    console.log('No configurable MCP clients found.');
    console.log('');
    if (errored.length > 0) process.exitCode = 1;
    return;
  }

  const choices = selectable.map((it) => ({
    name: it.name,
    value: it.cfgPath,
    checked: it.custom ? true : !!it.detected,
    hint: choiceHint(it),
  }));

  const selectedPaths = await checkbox('Select clients to configure:', choices);
  if (selectedPaths === null) {
    console.log('Aborted.');
    console.log('');
    return;
  }

  const selectedItems = selectable.filter((it) => selectedPaths.includes(it.cfgPath));
  const toApply = selectedItems.filter((it) => it.action === 'install' || it.action === 'update');

  printErrored(errored);

  if (toApply.length === 0) {
    console.log('Nothing to apply.');
    console.log('');
    return;
  }

  console.log('Changes to apply:');
  for (const it of toApply) {
    const label = it.action === 'update' ? 'UPDATE' : 'ADD';
    console.log(`  ${label.padEnd(6)}  ${it.name.padEnd(16)}  ${it.cfgPath}`);
  }
  console.log('');

  await applyAndReport(selectedItems);
}

// Flag-driven / non-interactive path: preview → confirm (unless --yes) → apply.
async function runFlags({ force, yes, includeAll, customPaths, clientFilter }) {
  const items = preview({
    force,
    includeAll,
    customPaths,
    clientFilter: clientFilter.length ? clientFilter : undefined,
  });

  printSections(items);

  const actionable = items.filter((i) => i.action === 'install' || i.action === 'update');
  const errored    = items.filter((i) => i.action === 'error');

  if (actionable.length === 0) {
    if (errored.length > 0) process.exitCode = 1;
    console.log('');
    return;
  }

  console.log('');

  if (yes) {
    await applyAndReport(items);
    return;
  }

  const answer = await askYesNo('Apply changes? [Y/n] ');
  if (!answer || answer.toLowerCase() === 'y') {
    await applyAndReport(items);
  } else {
    console.log('Aborted.');
    console.log('');
  }
}

function choiceHint(it) {
  if (it.action === 'no-change') return 'already configured';
  if (it.action === 'update')    return 'update';
  if (it.custom)                 return 'custom path';
  return it.detected ? 'detected' : 'not detected';
}

function printErrored(errored) {
  if (errored.length === 0) return;
  console.log('Could not parse existing config (left untouched):');
  for (const item of errored) {
    console.log(`  ${item.name.padEnd(16)}  ${item.cfgPath}`);
    console.log(`      ${item.error}`);
  }
  console.log('  → fix or remove the file, then re-run.');
  console.log('');
}

function printSections(items) {
  const actionable = items.filter((i) => i.action === 'install' || i.action === 'update');
  const skipped    = items.filter((i) => i.action === 'skipped');
  const unchanged  = items.filter((i) => i.action === 'no-change');
  const errored    = items.filter((i) => i.action === 'error');

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
    console.log('  → use --all, or --client <name>, to configure them anyway');
  }

  if (unchanged.length > 0) {
    if (actionable.length > 0 || errored.length > 0 || skipped.length > 0) console.log('');
    console.log(`Already up to date: ${unchanged.map((i) => i.name).join(', ')}`);
  }

  if (actionable.length === 0
      && unchanged.length > 0 && skipped.length === 0 && errored.length === 0) {
    console.log('Run with --force to re-apply.');
  }
}

function askYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function applyAndReport(items) {
  const applied = applyChanges(items);
  const failed   = applied.filter((r) => !r.ok);
  const okWrites = applied.filter((r) => r.ok);

  if (failed.length > 0) {
    console.log('Some files could not be written:');
    for (const r of failed) {
      console.log(`  ${r.name.padEnd(16)}  ${r.error}`);
    }
    console.log('');
    process.exitCode = 1;
  }

  if (okWrites.length === 0) {
    console.log('');
    return;
  }

  console.log('Done. Next steps:');
  console.log('  1. Restart the configured client(s)');
  console.log('  2. On first use, a browser window will open for OAuth authorization');
  console.log('');

  await verifyAndReport(okWrites);
}

// Post-write verification: each written config still holds the vidalytics entry,
// and the MCP server URL actually answers. Never changes what was written — a
// failure here is a warning so a broken install surfaces now, not later.
async function verifyAndReport(okWrites) {
  const badWrites = [];
  for (const r of okWrites) {
    const v = verifyWritten(r.cfgPath);
    if (!v.ok) badWrites.push({ name: r.name, error: v.error });
  }

  const url = resolveUrl();
  const reach = await verifyUrl(url);

  console.log('Verification:');
  if (badWrites.length === 0) {
    console.log(`  [ok] config written for: ${okWrites.map((r) => r.name).join(', ')}`);
  } else {
    for (const b of badWrites) {
      console.log(`  [!!] ${b.name}: ${b.error}`);
    }
    process.exitCode = 1;
  }

  if (reach.ok) {
    console.log(`  [ok] MCP server reachable (${url})`);
  } else {
    console.log(`  [! ] could not reach MCP server (${url}): ${reach.error}`);
    console.log('       config is written; check your network or VIDALYTICS_MCP_URL if the client cannot connect.');
  }
  console.log('');
}
