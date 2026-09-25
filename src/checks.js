// The checklist behind `env-sync doctor`, and the gate every other command runs
// before it touches anything. Each step either passes with a short note or
// throws a CliError carrying the cause (what 1Password said) and the fix.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, readConfig } from './config.js';
import { CliError, EXIT, formatProblem, mark } from './errors.js';
import { confirm, repoRoot, requireIgnored, scratchDir } from './fsutil.js';
import { cmd } from './hint.js';
import { notInstalled, Op } from './op.js';
import { missingProblem, resolveAll, staleRows, templateMissing } from './pull.js';

export const interactive = () => process.stdin.isTTY || process.env.ENV_SYNC_INTERACTIVE === '1';

/** Runs one step; on a fixable failure, offers the fix (in a terminal) and retries once. */
export function attempt(step, log) {
  try { return step(); } catch (e) {
    if (!(e instanceof CliError) || !e.autofix || !interactive()) throw e;
    log.out(formatProblem(e));
    if (!confirm(e.autofix.prompt)) throw e;
    e.autofix.run();
    return step();
  }
}

export const steps = {
  node() {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 20) {
      throw new CliError(EXIT.USAGE, `Node ${process.versions.node} is too old (needs 20 or newer)`, { fix: ['Install Node 20+: https://nodejs.org   (or: nvm install 20)'] });
    }
    return `Node ${process.versions.node}`;
  },
  op() {
    const r = spawnSync('op', ['--version'], { encoding: 'utf8' });
    if (r.error || r.status !== 0) throw notInstalled();
    return `1Password CLI ${r.stdout.trim()}`;
  },
  repo() { return repoRoot(); },
  config(root) {
    if (!fs.existsSync(path.join(root, CONFIG_FILE))) {
      throw new CliError(EXIT.USAGE, `No ${CONFIG_FILE} in this repo`, { fix: [
        'git pull   (it is committed with the project), or',
        `set this project up once: ${cmd('setup', ['--vault', '"<Project> Dev"'])}`,
      ] });
    }
    return readConfig(root);
  },
  ignored(root) { requireIgnored(root); },
  templates(cfg) {
    const gone = cfg.rows.filter((r) => r.kind === 'env' && !fs.existsSync(r.templateAbs)).map((r) => r.template);
    if (gone.length) throw templateMissing(gone);
  },
};

/** `env-sync doctor`: every check, top to bottom, with a fix for each problem. */
export function runDoctor({ log }) {
  const results = [];
  let firstCode = null;
  const pass = (title) => results.push(`  ${mark.ok} ${title}`);
  const skip = (title, why) => results.push(`  ${mark.skip} ${title}  (skipped until ${why})`);
  const fail = (e) => { results.push(formatProblem(e)); firstCode ??= e.code; };
  const tryStep = (fn) => { try { return { ok: true, value: attempt(fn, log) }; } catch (e) { if (!(e instanceof CliError)) throw e; fail(e); return { ok: false }; } };

  let r = tryStep(steps.node); if (r.ok) pass(`${r.value} (needs 20+)`);
  const opOk = tryStep(steps.op); if (opOk.ok) pass(opOk.value);
  const repo = tryStep(steps.repo); if (repo.ok) pass(`Git repository: ${repo.value}`);

  let cfg = null;
  if (repo.ok) {
    const c = tryStep(() => steps.config(repo.value));
    if (c.ok) {
      cfg = c.value;
      const envs = cfg.rows.filter((x) => x.kind === 'env').length;
      pass(`${CONFIG_FILE}: ${envs} env files, ${cfg.rows.length - envs} documents, vault "${cfg.vault}"${cfg.account ? `, account "${cfg.account}"` : ''}`);
    }
    r = tryStep(() => steps.ignored(repo.value)); if (r.ok) pass('.env-sync.* is in .gitignore');
  } else { skip(CONFIG_FILE, 'inside a git repository'); }

  let op = null;
  let signedIn = false;
  if (cfg && opOk.ok) {
    op = new Op({ account: cfg.account, vault: cfg.vault, scratch: null });
    r = tryStep(() => op.requireSignedIn());
    if (r.ok) { signedIn = true; pass(`Signed in to 1Password${cfg.account ? ` (account "${cfg.account}")` : ''}`); }
  } else { skip('Signed in to 1Password', cfg ? 'the 1Password CLI is installed' : `${CONFIG_FILE} is fixed`); }

  let vaultOk = false;
  if (signedIn) { r = tryStep(() => op.preflight()); if (r.ok) { vaultOk = true; pass(`Vault "${cfg.vault}" is reachable`); } }
  else skip(`Vault${cfg ? ` "${cfg.vault}"` : ''}`, 'signed in');

  let templatesOk = false;
  if (cfg) { r = tryStep(() => steps.templates(cfg)); if (r.ok) { templatesOk = true; pass('Every template is present'); } }

  if (vaultOk && templatesOk && repo.ok) {
    let resolved = null;
    try {
      op.scratch = scratchDir(repo.value);
      resolved = resolveAll({ cfg, op, scratch: op.scratch, rows: cfg.rows });
    } catch (e) { if (!(e instanceof CliError)) throw e; fail(e); }
    if (resolved) {
      if (resolved.missing.length) fail(missingProblem(cfg.vault, resolved.missing));
      else pass('Every variable and document is in 1Password');
      const stale = staleRows(resolved.plans);
      if (!resolved.missing.length) {
        if (stale.length) { results.push(`  ${mark.warn} Out of date: ${stale.map((p) => p.row.dest).join(', ')}\n      Fix: ${cmd('pull')}`); firstCode ??= EXIT.DRIFT; }
        else pass('Your local files are up to date');
      }
    }
  } else { skip('Variables in 1Password', 'the vault and templates are available'); }

  for (const line of results) log.out(line);
  const problems = results.filter((l) => l.includes(mark.fail) || l.includes(mark.warn)).length;
  log.out(problems ? `\n  ${problems} to fix. Work top to bottom, then run: ${cmd('pull')}` : `\n  Everything looks good.`);
  return firstCode ?? EXIT.OK;
}
