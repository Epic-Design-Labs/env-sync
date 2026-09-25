// One-time per project: move existing local values into 1Password and write
// the templates. Prints names only. Verifies by rendering every template back
// through the same code `pull` uses before it writes anything to the repo.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { appEntry, CONFIG_FILE } from './config.js';
import { classify } from './classify.js';
import { parseEnv, unquote } from './envfile.js';
import { CliError, EXIT } from './errors.js';
import { Op } from './op.js';
import { entryLookup, renderTemplate, SHARED } from './pull.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', 'coverage', '.vercel']);
const ENV_NAME = /^\.env(\.[A-Za-z0-9_-]+)*$/;

function templateFor(dest, taken) {
  const dir = path.posix.dirname(dest);
  const base = path.posix.basename(dest).replace(/\.local$/, '');
  let t = path.posix.join(dir, `${base}.template`);
  if (taken.has(t)) t = path.posix.join(dir, `${path.posix.basename(dest)}.template`);
  taken.add(t);
  return t;
}

/** Finds gitignored .env files, skipping examples, production and test files. */
function discover(source) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 5) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.env-sync.')) walk(path.join(dir, e.name), depth + 1); continue; }
      if (!ENV_NAME.test(e.name) || /(example|sample|template|production|prod|test)/i.test(e.name)) continue;
      const rel = path.relative(source, path.join(dir, e.name)).split(path.sep).join('/');
      if (spawnSync('git', ['check-ignore', '-q', rel], { cwd: source }).status === 0) found.push(rel);
    }
  };
  walk(source, 0);
  const taken = new Set();
  return found.sort().map((dest) => ({ kind: 'env', dest, template: templateFor(dest, taken), mode: 0o600 }));
}

function portablePath(value, sourceRoot, destAbs) {
  if (!path.isAbsolute(value)) return null;
  const abs = path.resolve(value);
  if (abs !== sourceRoot && !abs.startsWith(sourceRoot + path.sep)) return null;
  return { rel: path.relative(path.dirname(destAbs), abs).split(path.sep).join('/'), abs };
}

export function buildPlan({ rows, source, includes }) {
  const plan = { shared: new Map(), apps: new Map(), docs: [], templates: [], notes: [], excluded: [] };
  const origin = new Map();
  for (const row of rows) {
    const srcAbs = path.join(source, row.dest);
    if (row.kind === 'file') {
      if (!fs.existsSync(srcAbs)) throw new CliError(EXIT.USAGE, `${row.dest}: listed in ${CONFIG_FILE} but not found under ${source}`);
      if (/production|prod/i.test(row.title)) {
        throw new CliError(EXIT.USAGE, `${row.dest} looks like a production key. This vault is for development — remove it from ${CONFIG_FILE}.`);
      }
      plan.docs.push({ title: row.title, srcAbs });
      continue;
    }
    if (!fs.existsSync(srcAbs)) { plan.notes.push(`${row.dest}: no local file, skipped`); continue; }
    const { order, values } = parseEnv(fs.readFileSync(srcAbs, 'utf8'));
    const t = { row, srcAbs, lines: [], expect: new Map(), secrets: [], literals: [] };
    t.lines.push(`# ${row.template} — secrets are blank and filled from 1Password by name.`, '# Plain settings live here. Run `pnpm env:pull` to render it.', '');
    const entry = appEntry(row);
    for (const key of order) {
      const raw = values.get(key);
      const value = unquote(raw);
      const c = classify(key, value, { include: includes.has(`${key}@${row.dest}`) });
      if (c.kind === 'skipped') { plan.notes.push(`${row.dest}: ${key} skipped (${c.reason})`); continue; }
      if (c.kind === 'excluded') { plan.excluded.push(`${row.dest}: ${key} (${c.reason})`); t.expect.set(key, { absent: true }); continue; }
      if (c.kind === 'literal') {
        const p = portablePath(value, source, srcAbs);
        if (p) {
          t.lines.push(`${key}=${p.rel}`);
          t.expect.set(key, { path: p.abs, base: path.dirname(srcAbs) });
          plan.notes.push(`${row.dest}: ${key} made repo-relative so it works on every machine`);
        } else {
          t.lines.push(`${key}=${raw}`);
          t.expect.set(key, { value });
        }
        t.literals.push(key);
        continue;
      }
      if (value === '') {
        t.lines.push(`${key}=""`);
        t.expect.set(key, { value: '' });
        plan.notes.push(`${row.dest}: ${key} is empty locally, kept as an empty setting`);
        continue;
      }
      if (c.reason) plan.notes.push(`${row.dest}: ${key} stored as a secret (${c.reason})`);
      let target = SHARED;
      if (plan.shared.has(key) && plan.shared.get(key) !== value) {
        target = entry;
        plan.notes.push(`${row.dest}: ${key} differs from ${origin.get(key)}, so "${entry}" gets its own value`);
      }
      if (target === SHARED) { plan.shared.set(key, value); if (!origin.has(key)) origin.set(key, row.dest); }
      else {
        if (!plan.apps.has(entry)) plan.apps.set(entry, new Map());
        const prior = plan.apps.get(entry).get(key);
        if (prior !== undefined && prior !== value) {
          throw new CliError(EXIT.USAGE, `${key} has three different values (Shared, and two files that share the "${entry}" entry). Make them agree, then re-run.`);
        }
        plan.apps.get(entry).set(key, value);
      }
      t.lines.push(`${key}=`);
      t.expect.set(key, { value });
      t.secrets.push(key);
    }
    plan.templates.push(t);
  }
  return plan;
}

function printPlan(plan, vault, log) {
  for (const t of plan.templates) {
    log.out(`${t.row.dest} -> ${t.row.template}`);
    log.out(`  secrets  -> 1Password: ${t.secrets.join(', ') || '(none)'}`);
    log.out(`  settings -> template:  ${t.literals.join(', ') || '(none)'}`);
  }
  if (plan.notes.length) { log.out('\nNotes:'); for (const n of plan.notes) log.out(`  ${n}`); }
  if (plan.excluded.length) {
    log.out('\nExcluded, because this vault is for development only:');
    for (const e of plan.excluded) log.out(`  - ${e}`);
    log.out('  If one of these is really a dev value: --include KEY@path/to/.env');
  }
  const apps = [...plan.apps].map(([k, v]) => `${k} (${[...v.keys()].join(', ')})`);
  log.out(`\nVault "${vault}": Shared with ${plan.shared.size} secrets` +
    (apps.length ? `; own entries for ${apps.join('; ')}` : '') +
    (plan.docs.length ? `; ${plan.docs.length} documents` : ''));
}

function verify(plan, op, scratch) {
  const failures = [];
  const lookup = entryLookup(op);
  for (const t of plan.templates) {
    const { text, missing } = renderTemplate(t.row, t.lines.join('\n') + '\n', lookup);
    for (const k of missing) failures.push(`${t.row.dest}: ${k} is not readable from 1Password`);
    const got = parseEnv(text).values;
    for (const [k, want] of t.expect) {
      const v = got.has(k) ? unquote(got.get(k)) : undefined;
      if (want.absent) { if (v !== undefined) failures.push(`${t.row.dest}: ${k} should be excluded`); continue; }
      if (v === undefined) { failures.push(`${t.row.dest}: ${k} is missing after rendering`); continue; }
      if (want.path ? path.resolve(want.base, v) !== want.path : v !== want.value) {
        failures.push(`${t.row.dest}: ${k} does not match your local value`);
      }
    }
  }
  for (const d of plan.docs) {
    const tmp = path.join(scratch, `verify-doc-${d.title}`);
    const ok = op.getDocument(d.title, tmp) && fs.readFileSync(tmp).equals(fs.readFileSync(d.srcAbs));
    fs.rmSync(tmp, { force: true });
    if (!ok) failures.push(`${d.title}: document does not read back byte-identical`);
  }
  return failures;
}

export function runSetup({ root, source, cfg, vault, account, rehearse, force, includes, scratch, log }) {
  const rows = cfg?.rows ?? discover(source).map((r) => ({ ...r, templateAbs: path.join(root, r.template), destAbs: path.join(root, r.dest) }));
  if (!rows.length) throw new CliError(EXIT.USAGE, 'no gitignored .env files found, and no env-sync.conf to say which to use');
  if (!rehearse && !force) {
    const existing = rows.filter((r) => r.kind === 'env' && fs.existsSync(path.join(root, r.template)));
    if (existing.length) throw new CliError(EXIT.USAGE, `templates already exist (${existing.map((r) => r.template).join(', ')}). Re-run with --force to overwrite.`);
  }

  log.out(`Reading local values from ${source}\n`);
  const plan = buildPlan({ rows, source, includes });
  printPlan(plan, vault, log);

  const target = rehearse ? `${vault} (rehearsal)` : vault;
  const op = new Op({ account, vault: target, scratch });
  if (op.run(['whoami']).status !== 0) throw new CliError(EXIT.NO_OP, 'not signed in to 1Password. Unlock the app or run: op signin');
  const exists = op.vaultExists(target);
  if (exists && rehearse) throw new CliError(EXIT.USAGE, `"${target}" is left over from an earlier rehearsal. Delete it first: op vault delete "${target}"`);
  if (exists && op.listTitles().size && !force) throw new CliError(EXIT.USAGE, `"${target}" already has entries. Re-run with --force to add to it.`);
  if (!exists) { op.createVault(target); log.out(`\nCreated vault "${target}"`); }

  let failures;
  try {
    if (plan.shared.size) { op.createEntry(SHARED, plan.shared); log.out(`  created  ${SHARED}  (${plan.shared.size} fields)`); }
    for (const [title, fields] of plan.apps) { op.createEntry(title, fields); log.out(`  created  ${title}  (${fields.size} fields)`); }
    for (const d of plan.docs) { op.createDocument(d.title, d.srcAbs); log.out(`  created  ${d.title}  (document)`); }
    if (rehearse) {
      // Exercise the path `env-sync add` uses, against the throwaway vault.
      if (!plan.shared.size) op.createEntry(SHARED, new Map([['ENV_SYNC_SELFTEST', 'seed']]));
      op.addField(SHARED, 'ENV_SYNC_SELFTEST_ADD', 'ok');
      if (op.fields(SHARED).get('ENV_SYNC_SELFTEST_ADD') !== 'ok') throw new CliError(EXIT.DRIFT, 'the add-a-secret path did not read back');
    }
    log.out('\nVerifying: rendering every template back from 1Password ...');
    failures = verify(plan, op, scratch);
  } finally {
    if (rehearse) { op.deleteVault(target); log.out(`Deleted rehearsal vault "${target}"`); }
  }

  if (failures.length) {
    log.out('\nVERIFICATION FAILED — the vault does not reproduce your local files:');
    for (const f of failures) log.out(`  ! ${f}`);
    return EXIT.DRIFT;
  }
  log.out('verification clean: every template renders back to your local values');
  if (rehearse) { log.out('\nRehearsal passed. Now run it for real: pnpm env:setup'); return EXIT.OK; }

  for (const t of plan.templates) {
    fs.mkdirSync(path.dirname(path.join(root, t.row.template)), { recursive: true });
    fs.writeFileSync(path.join(root, t.row.template), t.lines.join('\n') + '\n');
  }
  if (!cfg) {
    const body = [`# ${CONFIG_FILE} — see https://github.com/Epic-Design-Labs/env-sync`, account ? `account = ${account}` : null,
      `vault   = ${vault}`, '', ...rows.map((r) => `env  ${r.template} -> ${r.dest}`)].filter((l) => l !== null);
    fs.writeFileSync(path.join(root, CONFIG_FILE), body.join('\n') + '\n');
  }
  log.out(`\nWrote ${plan.templates.length} templates${cfg ? '' : ` and ${CONFIG_FILE}`}. They contain no secret values — review and commit them.`);
  return EXIT.OK;
}
