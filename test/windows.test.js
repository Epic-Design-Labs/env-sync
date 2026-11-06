// Windows behaviour, exercised on any OS by faking process.platform.
// Windows has no Unix permission bits: chmod only toggles read-only, and stat
// reports 0o666 for every writable file, so mode checks must not run there.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { notInstalled, Op, sessionVars } from '../src/op.js';
import { staleRows } from '../src/pull.js';
import { loadSession, sessionFile } from '../src/session.js';

const real = process.platform;
const pretend = (p) => Object.defineProperty(process, 'platform', { value: p, configurable: true });

describe('on Windows', () => {
  let dir;
  beforeEach(() => {
    pretend('win32');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-sync-win-'));
    process.env.XDG_CACHE_HOME = dir;
  });
  afterEach(() => {
    pretend(real);
    delete process.env.XDG_CACHE_HOME;
    delete process.env.OP_SESSION_TESTUSER;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a file with the right content is current, whatever stat says its mode is', () => {
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, 'A=1\n', { mode: 0o644 });
    const plans = [{ row: { destAbs: file, mode: 0o600 }, data: Buffer.from('A=1\n') }];
    assert.equal(staleRows(plans).length, 0);
    pretend(real);
    if (real !== 'win32') assert.equal(staleRows(plans).length, 1, 'on Unix the loose mode still counts as stale');
  });

  it('keeps a saved session even though stat reports it group-readable', () => {
    const file = sessionFile('acme');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ OP_SESSION_TESTUSER: 'tok' }), { mode: 0o644 });
    assert.deepEqual(loadSession('acme'), ['OP_SESSION_TESTUSER']);
    assert.ok(fs.existsSync(file));
  });

  const signedOutFix = () => new Op({ account: 'acme', vault: 'V', scratch: null }).signInProblem('You are not currently signed in.').fix.join('\n');

  it('in Git Bash, the sign-in hint is the bash form only', () => {
    process.env.MSYSTEM = 'MINGW64';
    try {
      const fix = signedOutFix();
      assert.match(fix, /eval "\$\(op signin --account acme \| sed 's\/\^\\\$env:\/export \/'\)"/);
      assert.doesNotMatch(fix, /Invoke-Expression/);
    } finally { delete process.env.MSYSTEM; }
  });

  it('in PowerShell or cmd, the sign-in hint is the PowerShell form, with a pointer away from cmd', () => {
    delete process.env.MSYSTEM;
    const fix = signedOutFix();
    assert.match(fix, /Invoke-Expression \$\(op signin --account acme\)/);
    assert.match(fix, /cmd/);
    assert.doesNotMatch(fix, /sed|eval/);
  });

  it('talks about Windows Hello, never Touch ID', () => {
    const op = new Op({ account: 'acme', vault: 'V', scratch: null });
    for (const said of ['You are not currently signed in.', 'no account found for filter "acme"', 'error initializing client: connecting to desktop app: timed out']) {
      const fix = op.signInProblem(said).fix.join('\n');
      assert.doesNotMatch(fix, /Touch ID/, said);
    }
    assert.match(op.signInProblem('no account found for filter "acme"').fix.join('\n'), /Windows Hello/);
  });

  it('suggests winget, not brew, when op is missing', () => {
    const fix = notInstalled().fix.join('\n');
    assert.match(fix, /winget install AgileBits\.1Password\.CLI/);
    assert.doesNotMatch(fix, /brew/);
  });
});

describe('on macOS', () => {
  beforeEach(() => pretend('darwin'));
  afterEach(() => pretend(real));
  it('keeps the brew, eval and Touch ID hints', () => {
    assert.match(notInstalled().fix.join('\n'), /brew install 1password-cli/);
    const fix = new Op({ account: 'acme', vault: 'V', scratch: null }).signInProblem('You are not currently signed in.').fix.join('\n');
    assert.match(fix, /eval \$\(op signin --account acme\)/);
    assert.match(fix, /Touch ID/);
    assert.doesNotMatch(fix, /Invoke-Expression|Windows Hello/);
  });
});

describe('reading op signin output', () => {
  it('understands the Unix form', () => {
    assert.deepEqual(sessionVars('export OP_SESSION_ABC="t1"\n# comment\n'), { OP_SESSION_ABC: 't1' });
  });
  it('understands the PowerShell form op prints on Windows', () => {
    assert.deepEqual(sessionVars('$env:OP_SESSION_ABC="t2"\n'), { OP_SESSION_ABC: 't2' });
  });
});
