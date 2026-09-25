import fs from 'node:fs';
import path from 'node:path';
import { appEntry } from './config.js';
import { diffKeys, parseTemplate, quoteValue } from './envfile.js';
import { CliError, EXIT } from './errors.js';
import { atomicWrite, confirm } from './fsutil.js';

export const SHARED = 'Shared';

/** Loads 1Password entries on demand: the app's own entry wins, then Shared. */
export function entryLookup(op) {
  const titles = op.listTitles();
  const cache = new Map();
  const get = (title) => {
    if (!titles.has(title)) return null;
    if (!cache.has(title)) cache.set(title, op.fields(title));
    return cache.get(title);
  };
  return { titles, get };
}

/** Fills a template's blank variables by name. Returns { text, missing }. */
export function renderTemplate(row, templateText, lookup, warn = () => {}) {
  const app = lookup.get(appEntry(row));
  const shared = lookup.get(SHARED);
  const missing = [];
  const out = parseTemplate(templateText).map((l) => {
    if (l.kind === 'odd') warn(`${row.template} line ${l.n} is not KEY=value and is copied as-is`);
    if (l.kind !== 'vault') return l.line;
    const v = app?.get(l.key) ?? shared?.get(l.key);
    if (v === undefined) { missing.push(l.key); return l.line; }
    return `${l.key}=${quoteValue(v)}`;
  });
  return { text: out.join('\n') + '\n', missing };
}

function describe(row, current, rendered) {
  if (row.kind === 'file') return [];
  const d = diffKeys(current, rendered);
  return [
    ...d.added.map((k) => `  + ${k} (new)`),
    ...d.changed.map((k) => `  ~ ${k} (changed)`),
    ...d.removed.map((k) => `  - ${k} (not in template, will be dropped)`),
    `  ${d.unchanged} unchanged.`,
  ];
}

export function runPull(mode, { cfg, op, scratch, only, yes, dryRun, log }) {
  const rows = only ? cfg.rows.filter((r) => r.dest === only) : cfg.rows;
  if (only && !rows.length) throw new CliError(EXIT.USAGE, `--only "${only}" matches no entry in env-sync.conf`);

  // Resolve everything first. Nothing is written unless every row resolves.
  const lookup = entryLookup(op);
  const plans = [];
  const missing = [];
  for (const row of rows) {
    if (row.kind === 'env') {
      if (!fs.existsSync(row.templateAbs)) throw new CliError(EXIT.USAGE, `missing template: ${row.template}`);
      const r = renderTemplate(row, fs.readFileSync(row.templateAbs, 'utf8'), lookup, (m) => log.warn(m));
      if (r.missing.length) missing.push(`${row.template}: ${r.missing.join(', ')}`);
      plans.push({ row, data: Buffer.from(r.text) });
    } else {
      const tmp = path.join(scratch, `doc-${plans.length}`);
      if (!op.getDocument(row.title, tmp)) { missing.push(`${row.dest}: no document "${row.title}"`); continue; }
      plans.push({ row, data: fs.readFileSync(tmp) });
      fs.rmSync(tmp, { force: true });
    }
  }
  if (missing.length) {
    throw new CliError(EXIT.MISSING,
      `not in 1Password ("${cfg.vault}"), so nothing was written:\n  ${missing.join('\n  ')}\n` +
      'Add a missing variable with: env-sync add KEY');
  }

  let drifted = false;
  for (const { row, data } of plans) {
    const exists = fs.existsSync(row.destAbs);
    const current = exists ? fs.readFileSync(row.destAbs) : null;
    const modeOk = exists && (fs.statSync(row.destAbs).mode & 0o777) === row.mode;
    log.out(row.dest);
    if (current && current.equals(data) && modeOk) { log.out('  up to date.\n'); continue; }
    drifted = true;
    for (const line of describe(row, current?.toString(), data.toString())) log.out(line);
    if (current && current.equals(data)) log.out(`  permissions will be set to ${row.mode.toString(8)}`);
    if (mode === 'check' || dryRun) { log.out(mode === 'check' ? '' : '  (dry run — nothing written)\n'); continue; }
    if (!yes && !confirm(row.kind === 'file' ? 'Write document?' : 'Apply?')) { log.out('  skipped.\n'); continue; }
    atomicWrite(scratch, row.destAbs, data, row.mode);
    log.out('  written.\n');
  }
  return mode === 'check' && drifted ? EXIT.DRIFT : EXIT.OK;
}
