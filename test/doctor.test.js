import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { CONF, exists, makeRepo, read, run, seed, write } from './helpers.js';

const VAULT = { 'Test Dev': { Shared: { DATABASE_URL: 'postgres://SEKRETdb@localhost/x' } } };
function project({ vault = VAULT, template = 'PORT=1\nDATABASE_URL=\n', ignore = true } = {}) {
  const dir = makeRepo({ ignoreScratch: ignore });
  write(dir, 'env-sync.conf', `${CONF}\nenv apps/server/.env.template -> apps/server/.env\n`);
  if (template !== null) write(dir, 'apps/server/.env.template', template);
  seed(dir, vault);
  return dir;
}
const doctor = (dir, env) => run(dir, ['doctor'], { env });
const noLeak = (r) => assert.ok(!r.all.includes('SEKRET'), `leaked:\n${r.all}`);

describe('env-sync doctor', () => {
  it('all green: every check passes and says so', () => {
    const dir = project(); run(dir, ['pull', '--yes']);
    const r = doctor(dir);
    assert.equal(r.status, 0, r.all);
    for (const t of [/Node \d/, /1Password CLI 2\.39\.0/, /Git repository/, /1 env file, 0 documents, vault "Test Dev", account "epicdesignlabs"/,
      /\.env-sync\.\* is in \.gitignore/, /Signed in to 1Password \(account "epicdesignlabs"\)/, /Vault "Test Dev" is reachable/,
      /Every template is present/, /Every variable and document is in 1Password/, /local files are up to date/, /Everything looks good/]) assert.match(r.stdout, t);
    noLeak(r);
  });
  it('signed out: shows what 1Password said and the exact command, skips what depends on it', () => {
    const r = doctor(project(), { FAKE_OP_SIGNED_OUT: '1' });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /✗ Not signed in to 1Password \(account "epicdesignlabs"\)/);
    assert.match(r.stdout, /1Password said: You are not currently signed in/);
    assert.match(r.stdout, /Fix: eval \$\(op signin --account epicdesignlabs\)/);
    assert.match(r.stdout, /Vault "Test Dev"\s+\(skipped until signed in\)/);
    assert.match(r.stdout, /Work top to bottom, then run: pnpm env:pull/);
  });
  it('the 1Password app not answering is told apart from being signed out', () => {
    const r = doctor(project(), { FAKE_OP_APP_TIMEOUT: '1' });
    assert.match(r.stdout, /The 1Password app did not answer/);
    assert.match(r.stdout, /Open the 1Password app and unlock it/);
    assert.match(r.stdout, /Integrate with 1Password CLI/);
  });
  it('an account the CLI does not know gets the add-account fix', () => {
    const r = doctor(project(), { FAKE_OP_ACCOUNT: 'someone-else' });
    assert.match(r.stdout, /does not know the account "epicdesignlabs"/);
    assert.match(r.stdout, /op account add --address epicdesignlabs\.1password\.com/);
  });
  it('no access to the vault: who to ask, and how to create one', () => {
    const r = doctor(project({ vault: { 'Other Dev': {} } }));
    assert.equal(r.status, 3);
    assert.match(r.stdout, /No access to the vault "Test Dev"/);
    assert.match(r.stdout, /Ask whoever manages "Test Dev"/);
    assert.match(r.stdout, /pnpm env:setup/);
  });
  it('a missing template points at git pull', () => {
    const r = doctor(project({ template: null }));
    assert.match(r.stdout, /Template missing: apps\/server\/\.env\.template/);
    assert.match(r.stdout, /git pull/);
  });
  it('a variable missing from 1Password gets the env:add command for it', () => {
    const r = doctor(project({ template: 'PORT=1\nDATABASE_URL=\nNEW_TOKEN=\n' }));
    assert.equal(r.status, 4);
    assert.match(r.stdout, /NEW_TOKEN {2}\(apps\/server\/\.env\.template\)/);
    assert.match(r.stdout, /pnpm env:add NEW_TOKEN --to apps\/server\/\.env\.template/);
    noLeak(r);
  });
  it('out of date is a warning with the pull command, exit 1', () => {
    const r = doctor(project());
    assert.equal(r.status, 1);
    assert.match(r.stdout, /! Out of date: apps\/server\/\.env/);
    assert.match(r.stdout, /Fix: pnpm env:pull/);
  });
  it('a missing .gitignore rule shows the exact line to add', () => {
    const r = doctor(project({ ignore: false }));
    assert.match(r.stdout, /\.gitignore does not cover/);
    assert.match(r.stdout, /Add this line to \.gitignore: {2}\.env-sync\.\*/);
  });
  it('outside a git repo: says so and skips the rest', () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nogit-'));
    const r = doctor(dir);
    assert.equal(r.status, 5);
    assert.match(r.stdout, /Not inside a git repository/);
    assert.match(r.stdout, /skipped until inside a git repository/);
  });
});

describe('hints use the command the person actually runs', () => {
  it('npm projects are told `npm run env:...`', () => {
    const r = run(project(), ['check'], { env: { npm_config_user_agent: 'npm/10.8.2 node/v20' } });
    assert.match(r.stdout, /Out of date\. Run: npm run env:pull/);
  });
  it('outside a package script: `npx env-sync ...`', () => {
    const r = run(project(), ['check'], { env: { npm_config_user_agent: '' } });
    assert.match(r.stdout, /Out of date\. Run: npx env-sync pull/);
  });
  it('the rehearsal tells you the real command with your own flags', () => {
    const src = makeRepo(); write(src, 'apps/server/.env', 'PORT=1\n');
    const dir = project();
    const r = run(dir, ['setup', '--rehearse', '--source', src, '--vault', 'Test Dev']);
    assert.equal(r.status, 0, r.all);
    assert.match(r.stdout, new RegExp(`pnpm env:setup --source ${src.replace(/[/.]/g, '\\$&')} --vault "Test Dev"`));
  });
});

describe('fixes it offers, and only after asking', () => {
  it('signs you in when you say yes, keeps the session in memory, never prints it', () => {
    const dir = project();
    const r = run(dir, ['pull', '--yes'], { env: { FAKE_OP_SIGNED_OUT: '1', ENV_SYNC_INTERACTIVE: '1' }, input: 'y\nhunter2\n' });
    assert.equal(r.status, 0, r.all);
    assert.match(r.stdout, /Sign in to 1Password now\?/);
    assert.match(read(dir, 'apps/server/.env'), /^DATABASE_URL=postgres:\/\/SEKRETdb@localhost\/x$/m);
    assert.ok(!r.all.includes('tok-SEKRETsession'), 'session token printed');
  });
  it('saying no leaves you with the manual fix and exit 2', () => {
    const r = run(project(), ['pull', '--yes'], { env: { FAKE_OP_SIGNED_OUT: '1', ENV_SYNC_INTERACTIVE: '1' }, input: 'n\n' });
    assert.equal(r.status, 2); assert.match(r.all, /eval \$\(op signin --account epicdesignlabs\)/);
  });
  it('a wrong password fails cleanly', () => {
    const r = run(project(), ['pull', '--yes'], { env: { FAKE_OP_SIGNED_OUT: '1', ENV_SYNC_INTERACTIVE: '1' }, input: 'y\nnope\n' });
    assert.equal(r.status, 2); assert.match(r.all, /Sign-in did not complete/);
  });
  it('never prompts when nobody is at a terminal', () => {
    const r = run(project(), ['pull', '--yes'], { env: { FAKE_OP_SIGNED_OUT: '1' }, input: 'y\nhunter2\n' });
    assert.equal(r.status, 2); assert.doesNotMatch(r.stdout, /now\?/);
  });
  it('adds the .gitignore rule when you say yes, then carries on', () => {
    const dir = project({ ignore: false });
    const r = run(dir, ['pull', '--yes'], { env: { ENV_SYNC_INTERACTIVE: '1' }, input: 'y\n' });
    assert.equal(r.status, 0, r.all);
    assert.match(read(dir, '.gitignore'), /^\.env-sync\.\*$/m); assert.ok(exists(dir, 'apps/server/.env'));
  });
});

describe('a project that has not been set up yet', () => {
  const fresh = () => project({ vault: { 'Other Dev': {} }, template: null });
  it('doctor reports one problem, not two, with both ways forward', () => {
    const r = run(fresh(), ['doctor']);
    assert.equal(r.status, 3);
    assert.match(r.stdout, /This project is not set up in 1Password yet/);
    assert.match(r.stdout, /pnpm env:setup --rehearse/);
    assert.match(r.stdout, /git pull, and ask them to share the vault "Test Dev"/);
    assert.doesNotMatch(r.stdout, /Template missing/);
    assert.match(r.stdout, /1 to fix/);
  });
  it('pull says the same thing', () => {
    const r = run(fresh(), ['pull']);
    assert.equal(r.status, 3); assert.match(r.stderr, /not set up in 1Password yet/);
  });
  it('a vault that exists but is not shared still gets the ask-for-access fix', () => {
    const r = run(project({ vault: { 'Other Dev': {} } }), ['doctor']);
    assert.match(r.stdout, /No access to the vault "Test Dev"/);
  });
});
