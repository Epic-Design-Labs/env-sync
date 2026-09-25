import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CliError, EXIT } from './errors.js';

export function repoRoot(cwd = process.cwd()) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new CliError(EXIT.USAGE, 'not inside a git repository');
  return fs.realpathSync(r.stdout.trim());
}

/**
 * Rendered secrets pass through a scratch directory at the repo root, so moving
 * them into place is a same-filesystem rename. That makes `.env-sync.*` in
 * .gitignore a containment control: without it a crash could leave plaintext
 * secrets where `git add -A` would pick them up.
 */
export function requireIgnored(root) {
  const r = spawnSync('git', ['check-ignore', '-q', '.env-sync.probe'], { cwd: root });
  if (r.status !== 0) {
    throw new CliError(EXIT.USAGE, "add '.env-sync.*' to .gitignore — env-sync renders secrets into the repo root");
  }
}

let active = null;
/** Creates an owner-only scratch dir at the repo root, removed on exit or signal. */
export function scratchDir(root) {
  const dir = fs.mkdtempSync(path.join(root, '.env-sync.'));
  fs.chmodSync(dir, 0o700);
  active = dir;
  return dir;
}
export function cleanupScratch() {
  if (active) fs.rmSync(active, { recursive: true, force: true });
  active = null;
}
process.on('exit', cleanupScratch);
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(sig, () => { cleanupScratch(); process.exit(code); });
}

/** Writes `data` to `dest` atomically: scratch file with final mode, then rename. */
export function atomicWrite(scratch, dest, data, mode) {
  const tmp = path.join(scratch, `write-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(tmp, data, { mode });
  fs.chmodSync(tmp, mode);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(tmp, dest);
  fs.chmodSync(dest, mode);
}

/** Reads one line from stdin synchronously. EOF returns ''. Works for TTYs and pipes. */
export function readLine() {
  const buf = Buffer.alloc(1);
  let out = '';
  for (;;) {
    let n;
    try { n = fs.readSync(0, buf, 0, 1, null); } catch (e) {
      if (e.code === 'EAGAIN') continue;
      if (e.code === 'EOF') break;
      throw e;
    }
    if (n === 0) break;
    const ch = buf.toString('utf8');
    if (ch === '\n') break;
    out += ch;
  }
  return out.replace(/\r$/, '');
}

export function confirm(question) {
  process.stdout.write(`  ${question} [y/N] `);
  return /^(y|yes)$/i.test(readLine().trim());
}

/** Reads a secret without echoing it. Non-TTY stdin (scripts, tests) is read as one line. */
export function readSecret(prompt) {
  process.stdout.write(prompt);
  if (!process.stdin.isTTY) {
    const v = readLine();
    process.stdout.write('\n');
    return v;
  }
  process.stdin.setRawMode(true);
  const buf = Buffer.alloc(1);
  let out = '';
  try {
    for (;;) {
      const n = fs.readSync(0, buf, 0, 1, null);
      if (n === 0) break;
      const c = buf[0];
      if (c === 3) { process.stdout.write('\n'); process.exit(130); }   // Ctrl-C
      if (c === 13 || c === 10) break;
      if (c === 127 || c === 8) { out = out.slice(0, -1); continue; }  // backspace
      out += buf.toString('utf8');
    }
  } finally {
    process.stdin.setRawMode(false);
    process.stdout.write('\n');
  }
  return out;
}
