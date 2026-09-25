import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BIN = path.resolve(import.meta.dirname, '../bin/env-sync.js');
export const FAKE = path.resolve(import.meta.dirname, 'fake-op');

/** A throwaway git repo. `.env-sync.*` is ignored unless ignoreScratch is false. */
export function makeRepo({ ignoreScratch = true } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'env-sync-test-')));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.writeFileSync(path.join(dir, '.gitignore'), `.env\n.env.local\n.secrets/\n${ignoreScratch ? '.env-sync.*\n' : ''}`);
  return dir;
}

export function write(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}
export const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
export const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
export const mode = (dir, rel) => fs.statSync(path.join(dir, rel)).mode & 0o777;

/** Writes fake-op state: vaults -> { entryTitle: {FIELD: value} } */
export function seed(dir, vaults) {
  const state = { vaults: {} };
  for (const [v, items] of Object.entries(vaults)) {
    state.vaults[v] = { items: {} };
    for (const [title, content] of Object.entries(items)) {
      state.vaults[v].items[title] = content instanceof Buffer ? { doc: content.toString('base64') } : { fields: content };
    }
  }
  fs.writeFileSync(path.join(dir, '..', `${path.basename(dir)}.state.json`), JSON.stringify(state));
}
export const statePath = (dir) => path.join(dir, '..', `${path.basename(dir)}.state.json`);
export const state = (dir) => (fs.existsSync(statePath(dir)) ? JSON.parse(fs.readFileSync(statePath(dir), 'utf8')) : { vaults: {} });

export function run(cwd, args, { env = {}, input = '' } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd, input, encoding: 'utf8',
    env: { ...process.env, npm_config_user_agent: 'pnpm/9.15.4 node/v20', PATH: `${FAKE}:${process.env.PATH}`, FAKE_OP_STATE: statePath(cwd), ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, all: r.stdout + r.stderr };
}

export const CONF = 'account = epicdesignlabs\nvault   = Test Dev\n';
