// env-sync.conf: which 1Password account and vault this repo uses, and which files to fill.
//
//   account = epicdesignlabs
//   vault   = Throttle Dev
//
//   env  apps/server/.env.template -> apps/server/.env
//   env  apps/dashboard/.env.template -> apps/dashboard/.env.local
//   file .secrets/gr4vy-sandbox.pem
//   file .secrets/signing.pem mode=400
import fs from 'node:fs';
import path from 'node:path';
import { CliError, EXIT } from './errors.js';

export const CONFIG_FILE = 'env-sync.conf';
const MODE_RE = /\s+mode=([0-7]{3,4})$/;

/** Owner-only: a rendered secret must never be group- or world-accessible. */
export function checkMode(mode, where) {
  if (!/^[0-7]{3,4}$/.test(mode)) throw new CliError(EXIT.USAGE, `${where}: mode "${mode}" is not an octal mode`);
  const bits = parseInt(mode, 8);
  if (bits & 0o077) {
    throw new CliError(EXIT.USAGE, `${where}: mode "${mode}" grants group or other access — rendered files must stay owner-only`);
  }
  return bits;
}

function inside(root, rel, where) {
  if (path.isAbsolute(rel)) throw new CliError(EXIT.USAGE, `${where}: "${rel}" must be relative to the repo root`);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new CliError(EXIT.USAGE, `${where}: "${rel}" points outside the repo`);
  }
  return abs;
}

export function parseConfig(text, root) {
  const cfg = { account: null, vault: null, rows: [] };
  const dests = new Set();
  text.split(/\r?\n/).forEach((raw, i) => {
    const where = `${CONFIG_FILE} line ${i + 1}`;
    const line = raw.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '').trim();
    if (!line) return;

    const setting = /^(account|vault)\s*=\s*(.+)$/.exec(line);
    if (setting) {
      cfg[setting[1]] = setting[2].trim();
      return;
    }

    let rest = line;
    let mode = '600';
    const m = MODE_RE.exec(rest);
    if (m) {
      mode = m[1];
      rest = rest.slice(0, m.index);
    }
    const kind = rest.split(/\s+/, 1)[0];
    const body = rest.slice(kind.length).trim();
    let row;
    if (kind === 'env') {
      const arrow = body.split(/\s+->\s+/);
      if (arrow.length !== 2 || !arrow[0] || !arrow[1]) {
        throw new CliError(EXIT.USAGE, `${where}: expected "env <template> -> <destination>"`);
      }
      row = { kind, template: arrow[0], dest: arrow[1] };
      row.templateAbs = inside(root, row.template, where);
    } else if (kind === 'file') {
      if (!body) throw new CliError(EXIT.USAGE, `${where}: expected "file <path>"`);
      row = { kind, dest: body, title: path.basename(body) };
    } else {
      throw new CliError(EXIT.USAGE, `${where}: unknown entry "${kind}" (expected account, vault, env or file)`);
    }
    row.destAbs = inside(root, row.dest, where);
    if (dests.has(row.dest)) throw new CliError(EXIT.USAGE, `${where}: "${row.dest}" is listed twice`);
    dests.add(row.dest);
    row.mode = checkMode(mode, where);
    row.line = i + 1;
    cfg.rows.push(row);
  });
  if (!cfg.vault) throw new CliError(EXIT.USAGE, `${CONFIG_FILE}: missing "vault = <name>"`);
  return cfg;
}

export function readConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(file)) {
    throw new CliError(EXIT.USAGE, `no ${CONFIG_FILE} at the repo root. Run \`env-sync setup\` to create one.`);
  }
  return parseConfig(fs.readFileSync(file, 'utf8'), root);
}

/** The 1Password entry holding values for one app: the template's directory, or "(root)". */
export function appEntry(row) {
  const dir = path.posix.dirname(row.template.split(path.sep).join('/'));
  return dir === '.' ? '(root)' : dir;
}
