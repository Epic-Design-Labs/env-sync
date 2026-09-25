// Thin wrapper over the 1Password CLI. Secret values travel only through
// stdout pipes and owner-only temp files; they are never put in an error message.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CliError, EXIT } from './errors.js';

// JSON.parse errors quote the text they fail on. Here that text is op's output,
// which holds secret values, so the message is replaced with a value-free one.
function parseJson(text, what) {
  try { return JSON.parse(text); } catch {
    throw new CliError(EXIT.MISSING, `unexpected output from 1Password while ${what}`);
  }
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
    if (r.error && r.error.code === 'ENOENT') {
      throw new CliError(EXIT.NO_OP, '1Password CLI (op) is not installed. brew install 1password-cli');
    }
    return r;
  }

  must(args, what) {
    const r = this.run(args);
    if (r.status !== 0) throw new CliError(EXIT.MISSING, `${what}: ${(r.stderr || '').trim()}`);
    return r;
  }

  preflight() {
    if (this.run(['whoami']).status !== 0) {
      const who = this.account ? ` to the "${this.account}" account` : '';
      throw new CliError(EXIT.NO_OP, `not signed in to 1Password${who}. Unlock the 1Password app (Settings → Developer → Integrate with 1Password CLI) or run: op signin`);
    }
    if (!this.vaultExists(this.vault)) {
      throw new CliError(EXIT.NO_VAULT, `cannot reach the "${this.vault}" vault. Ask whoever manages it for access.`);
    }
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
