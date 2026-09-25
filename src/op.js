// Thin wrapper over the 1Password CLI. Secret values travel only through
// stdout pipes and owner-only temp files; they are never put in an error message.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CliError, EXIT, opSaid } from './errors.js';
import { cmd } from './hint.js';

// JSON.parse errors quote the text they fail on. Here that text is op's output,
// which holds secret values, so the message is replaced with a value-free one.
function parseJson(text, what) {
  try { return JSON.parse(text); } catch {
    throw new CliError(EXIT.MISSING, `unexpected output from 1Password while ${what}`);
  }
}

// op's wording for "you are not signed in" (as opposed to "no such vault").
const SIGNED_OUT = /not currently signed in|no active session|sign ?in|authoriz|desktop app|no account found|not a known account|account "[^"]*" (not found|isn't)/i;

export function notInstalled() {
  return new CliError(EXIT.NO_OP, 'The 1Password CLI (op) is not installed', { fix: [
    'brew install 1password-cli',
    'Other systems: https://developer.1password.com/docs/cli/get-started/',
  ] });
}

export class Op {
  constructor({ account = null, vault, scratch }) {
    this.account = account;
    this.vault = vault;
    this.scratch = scratch;   // an owner-only directory for template files
  }

  run(args, { input } = {}) {
    const full = this.account ? [...args, '--account', this.account] : args;
    const r = spawnSync('op', full, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
    if (r.error && r.error.code === 'ENOENT') throw notInstalled();
    return r;
  }

  must(args, what) {
    const r = this.run(args);
    if (r.status !== 0) throw new CliError(EXIT.MISSING, `${what}: ${(r.stderr || '').trim()}`);
    return r;
  }

  /** Turns op's refusal into the specific cause and fix, from what op actually said. */
  signInProblem(stderr) {
    const said = opSaid(stderr);
    const a = this.account;
    const acct = a ? ` --account ${a}` : '';
    if (/desktop app/i.test(stderr) && /timed out|not running|connect/i.test(stderr)) {
      return new CliError(EXIT.NO_OP, 'The 1Password app did not answer', { said, fix: [
        'Open the 1Password app and unlock it.',
        'Then check Settings → Developer → "Integrate with 1Password CLI" is on.',
      ] });
    }
    if (/no account found|not a known account|account "[^"]*" (not found|isn't)/i.test(stderr)) {
      const address = a && !a.includes('.') ? `${a}.1password.com` : a;
      return new CliError(EXIT.NO_OP, `The 1Password CLI does not know the account "${a}"`, { said, fix: [
        `Add it in the 1Password app (then Touch ID works), or add it to the CLI: op account add --address ${address}`,
        `If "${a}" is the wrong account, fix the account line in env-sync.conf.`,
      ] });
    }
    if (/dismiss|cancel|denied/i.test(stderr)) {
      return new CliError(EXIT.NO_OP, 'The 1Password prompt was dismissed', { said, fix: ['Run the command again and approve the 1Password prompt.'] });
    }
    return new CliError(EXIT.NO_OP, `Not signed in to 1Password${a ? ` (account "${a}")` : ''}`, {
      said,
      fix: [
        `eval $(op signin${acct})`,
        'Or use Touch ID instead of a password: 1Password → Settings → Developer →',
        `"Integrate with 1Password CLI", and add ${a ? `your ${a} account` : 'your account'} to the app.`,
      ],
      autofix: { prompt: 'Sign in to 1Password now?', run: () => this.signInInteractive() },
    });
  }

  /**
   * Runs `op signin` with the person's terminal attached, so op can ask for a
   * password or show the app prompt. The session op prints is kept in this
   * process's environment (so every later op call uses it) and never printed.
   */
  signInInteractive() {
    const args = ['signin', ...(this.account ? ['--account', this.account] : [])];
    const r = spawnSync('op', args, { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
    if (r.status !== 0) {
      throw new CliError(EXIT.NO_OP, 'Sign-in did not complete', { fix: [`eval $(op signin${this.account ? ` --account ${this.account}` : ''})`, 'then run the command again.'] });
    }
    for (const m of (r.stdout || '').matchAll(/export (OP_SESSION_\w+)="([^"]*)"/g)) process.env[m[1]] = m[2];
  }

  /**
   * `op whoami` only reports an existing session; with the desktop-app
   * integration it never asks the app to unlock, so it says "signed out" even
   * when a real command would succeed. Probe with a command that does ask.
   */
  requireSignedIn() {
    const r = this.run(['vault', 'list', '--format', 'json']);
    if (r.status !== 0) throw this.signInProblem(r.stderr);
  }

  preflight() {
    const r = this.run(['vault', 'get', this.vault]);
    if (r.status === 0) return;
    if (SIGNED_OUT.test(r.stderr || '')) throw this.signInProblem(r.stderr);
    throw new CliError(EXIT.NO_VAULT, `No access to the vault "${this.vault}"`, { said: opSaid(r.stderr), fix: [
      `Ask whoever manages "${this.vault}" in 1Password to share it with you.`,
      `If this project has no vault yet, create it with: ${cmd('setup')}`,
    ] });
  }

  vaultExists(name) { return this.run(['vault', 'get', name]).status === 0; }
  createVault(name) { this.must(['vault', 'create', name], `could not create vault "${name}"`); }
  deleteVault(name) { this.run(['vault', 'delete', name]); }

  listTitles() {
    const r = this.must(['item', 'list', '--vault', this.vault, '--format', 'json'], `could not list "${this.vault}"`);
    return new Set(parseJson(r.stdout || '[]', `listing "${this.vault}"`).map((i) => i.title));
  }

  /** Map of field label -> value for one entry. */
  fields(title) {
    const r = this.must(['item', 'get', title, '--vault', this.vault, '--format', 'json', '--reveal'],
      `could not read "${title}" in "${this.vault}"`);
    const item = parseJson(r.stdout, `reading "${title}"`);
    const out = new Map();
    for (const f of item.fields ?? []) if (f.label && f.value !== undefined) out.set(f.label, String(f.value));
    return out;
  }

  createEntry(title, fields) {
    const file = path.join(this.scratch, `entry-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({
      title,
      category: 'SECURE_NOTE',
      fields: [...fields].map(([label, value]) => ({ label, type: 'CONCEALED', value })),
    }), { mode: 0o600 });
    try {
      this.must(['item', 'create', '--vault', this.vault, '--template', file], `could not create "${title}"`);
    } finally {
      fs.rmSync(file, { force: true });
    }
  }

  /** Adds one field. Assignment syntax is additive: it never rewrites the entry's other fields. */
  addField(title, label, value) {
    this.must(['item', 'edit', title, '--vault', this.vault, `${label}[concealed]=${value}`],
      `could not add ${label} to "${title}"`);
  }

  createDocument(title, file) {
    this.must(['document', 'create', file, '--vault', this.vault, '--title', title], `could not upload "${title}"`);
  }

  /** Downloads a document to `out`. Returns false when it does not exist. */
  getDocument(title, out) {
    const r = this.run(['document', 'get', title, '--vault', this.vault, '--out-file', out, '--force']);
    return r.status === 0;
  }
}
