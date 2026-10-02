// Remembers a 1Password session between runs. A sign-in env-sync performs
// lives in its own process, which ends with the command; without this, the
// next command asks again. The token is short-lived (1Password expires it
// after ~30 idle minutes) and is kept owner-only under the user's cache dir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function sessionFile(account) {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'env-sync', `session-${(account ?? 'default').replace(/[^\w.-]/g, '_')}.json`);
}

/** Puts a saved session into this process's environment. Returns the names it set. */
export function loadSession(account) {
  const file = sessionFile(account);
  let saved;
  try {
    if ((fs.statSync(file).mode & 0o077) !== 0) { forgetSession(account, []); return []; }
    saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return []; }
  const set = [];
  for (const [name, value] of Object.entries(saved)) {
    // A session the person exported in their own shell wins.
    if (/^OP_SESSION_\w+$/.test(name) && process.env[name] === undefined) { process.env[name] = String(value); set.push(name); }
  }
  return set;
}

export function saveSession(account, vars) {
  const file = sessionFile(account);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(file), 0o700);
  const tmp = `${file}.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(vars), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Drops a saved session, and the names it put into this process. */
export function forgetSession(account, names) {
  fs.rmSync(sessionFile(account), { force: true });
  for (const n of names) delete process.env[n];
}
