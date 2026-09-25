import fs from 'node:fs';
import path from 'node:path';
import { runAdd } from './add.js';
import { attempt, runDoctor, steps } from './checks.js';
import { CONFIG_FILE, readConfig } from './config.js';
import { CliError, EXIT, formatProblem } from './errors.js';
import { addIgnoreRule, requireIgnored, scratchDir } from './fsutil.js';
import { cmd } from './hint.js';
import { Op } from './op.js';
import { runPull } from './pull.js';
import { runSetup } from './setup.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const USAGE = `env-sync ${pkg.version} — render .env files from 1Password, matched by variable name

  env-sync pull   [--yes] [--dry-run] [--only <dest>]   write .env files from 1Password (default)
  env-sync check  [--only <dest>]                       exit 1 if any .env is out of date
  env-sync doctor                                       check your setup and show how to fix each problem
  env-sync add KEY [--to <template>] [--app]            add a new secret to 1Password and the template
  env-sync setup  [--rehearse] [--vault <name>] [--account <name>] [--source <dir>]
                  [--include KEY@path] [--force]        one-time: move a project's values into 1Password

Exit codes: 0 ok · 1 out of date · 2 op missing or signed out · 3 vault unreachable
            4 not in 1Password · 5 bad config or arguments`;

const FLAGS = {
  pull: { yes: 'bool', y: 'yes', 'dry-run': 'bool', only: 'str' },
  check: { only: 'str' },
  doctor: {},
  add: { to: 'str', app: 'bool' },
  setup: { rehearse: 'bool', scratch: 'rehearse', vault: 'str', account: 'str', source: 'str', include: 'list', force: 'bool' },
};

const argError = (msg) => Object.assign(new CliError(EXIT.USAGE, msg), { plain: true });

function parseArgs(cmdName, args) {
  const spec = FLAGS[cmdName];
  const out = { _: [], include: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('-')) { out._.push(a); continue; }
    let name = a.replace(/^--?/, '');
    let type = spec[name];
    if (type && !['bool', 'str', 'list'].includes(type)) { name = type; type = spec[name]; }
    if (!type) throw argError(`unknown option ${a} for "${cmdName}"\n\n${USAGE}`);
    if (type === 'bool') { out[name] = true; continue; }
    const v = args[++i];
    if (v === undefined || v.startsWith('-')) throw argError(`${a} needs a value`);
    if (type === 'list') out[name].push(v); else out[name] = v;
  }
  return out;
}

const shown = (a) => (/[\s"']/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

export async function main(argv) {
  const log = {
    out: (s) => process.stdout.write(`${s}\n`),
    warn: (s) => process.stderr.write(`warning: ${s}\n`),
  };
  try {
    const first = argv[0];
    if (first === '--version' || first === '-v') { log.out(pkg.version); return EXIT.OK; }
    if (first === 'help' || first === '--help' || first === '-h') { log.out(USAGE); return EXIT.OK; }
    const name = first && !first.startsWith('-') ? first : 'pull';
    if (!FLAGS[name]) throw argError(`unknown command "${name}"\n\n${USAGE}`);
    const rest = first === name ? argv.slice(1) : argv;
    const opts = parseArgs(name, rest);
    if (name === 'check' && opts.yes) throw argError('check never writes, so it takes no --yes');

    if (name === 'doctor') return runDoctor({ log });

    attempt(steps.node, log);
    attempt(steps.op, log);
    const root = attempt(steps.repo, log);

    if (name === 'setup') {
      const cfg = fs.existsSync(path.join(root, CONFIG_FILE)) ? readConfig(root) : null;
      const vault = opts.vault ?? cfg?.vault;
      if (!vault) {
        throw new CliError(EXIT.USAGE, 'Which vault should this project use?', { fix: [cmd('setup', ['--vault', '"<Project> Dev"']), `(or set "vault = ..." in ${CONFIG_FILE})`] });
      }
      // setup bootstraps a project, so it adds the containment rule itself and says so.
      try { requireIgnored(root); } catch { addIgnoreRule(root); log.out("Added '.env-sync.*' to .gitignore\n"); }
      const account = opts.account ?? cfg?.account ?? null;
      attempt(() => new Op({ account, vault, scratch: null }).requireSignedIn(), log);
      const again = rest.filter((a) => a !== '--rehearse' && a !== '--scratch').map(shown);
      return runSetup({
        root, cfg, vault, account,
        source: fs.realpathSync(path.resolve(opts.source ?? root)),
        rehearse: !!opts.rehearse, force: !!opts.force, includes: new Set(opts.include),
        scratch: scratchDir(root), log, rerun: cmd('setup', again),
      });
    }

    const cfg = attempt(() => steps.config(root), log);
    attempt(() => steps.ignored(root), log);
    const scratch = scratchDir(root);
    const op = new Op({ account: cfg.account, vault: cfg.vault, scratch });
    attempt(() => op.preflight(), log);

    if (name === 'add') return runAdd({ cfg, op, key: opts._[0], to: opts.to, app: !!opts.app, log });
    attempt(() => steps.templates(cfg), log);
    const code = runPull(name, { cfg, op, scratch, only: opts.only, yes: !!opts.yes, dryRun: !!opts['dry-run'], log });
    if (code === EXIT.DRIFT) log.out(`Out of date. Run: ${cmd('pull')}`);
    return code;
  } catch (e) {
    if (e instanceof CliError) {
      if (e.plain) process.stderr.write(`env-sync: ${e.message}\n`);
      else process.stderr.write(`${formatProblem(e)}\n\n  To check everything at once: ${cmd('doctor')}\n`);
      return e.code;
    }
    // Unexpected errors can carry data from op's output, so details are opt-in.
    if (process.env.ENV_SYNC_DEBUG) process.stderr.write(`${e.stack}\n`);
    else process.stderr.write(`env-sync: unexpected ${e.name}. Re-run with ENV_SYNC_DEBUG=1 for details.\n`);
    return EXIT.DRIFT;
  }
}
