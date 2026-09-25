import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach } from 'node:test';
import { CONF, exists, makeRepo, mode, read, run, seed, write } from './helpers.js';

const TEMPLATE = '# server\nPORT=3011\nDATABASE_URL=\nCLERK_SECRET_KEY=\n';
const VAULT = { 'Test Dev': { Shared: { DATABASE_URL: 'postgres://u:SEKRETdb@localhost/x', CLERK_SECRET_KEY: 'sk_test_SEKRETclerk' } } };
const noLeak = (r) => assert.ok(!r.all.includes('SEKRET'), `a secret value leaked into output:\n${r.all}`);

function project(conf = `${CONF}\nenv apps/server/.env.template -> apps/server/.env\n`, vault = VAULT) {
  const dir = makeRepo();
  write(dir, 'env-sync.conf', conf);
  write(dir, 'apps/server/.env.template', TEMPLATE);
  seed(dir, vault);
  return dir;
}

describe('preflight and exit codes', () => {
  it('exits 2 when op is not installed, before touching git', () => {
    const dir = project();
    const r = run(dir, ['pull'], { env: { PATH: '/nonexistent' } });
    assert.equal(r.status, 2); assert.match(r.stderr, /1Password CLI/);
  });
  it('exits 2 when signed out', () => {
    const r = run(project(), ['pull'], { env: { FAKE_OP_SIGNED_OUT: '1' } });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Not signed in to 1Password \(account "epicdesignlabs"\)/);
    assert.match(r.stderr, /1Password said: You are not currently signed in/);
    assert.match(r.stderr, /Fix: eval \$\(op signin --account epicdesignlabs\)/);
    assert.match(r.stderr, /pnpm env:doctor/);
  });
  it('exits 2 and names the account when the pinned account is not available', () => {
    const r = run(project(), ['pull'], { env: { FAKE_OP_ACCOUNT: 'someone-else' } });
    assert.equal(r.status, 2); assert.match(r.stderr, /epicdesignlabs/);
  });
  it('exits 3 when the vault is unreachable', () => {
    const r = run(project(undefined, { 'Other Dev': {} }), ['pull']);
    assert.equal(r.status, 3); assert.match(r.stderr, /Test Dev/);
  });
  it('exits 5 outside a git repo', () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'nogit-'));
    assert.equal(run(dir, ['pull']).status, 5);
  });
  it('exits 5 without env-sync.conf', () => {
    const dir = makeRepo(); seed(dir, VAULT);
    const r = run(dir, ['pull']); assert.equal(r.status, 5);
    assert.match(r.stderr, /No env-sync\.conf/); assert.match(r.stderr, /pnpm env:setup --vault/);
  });
  it('exits 5 when .env-sync.* is not gitignored, and writes nothing', () => {
    const dir = makeRepo({ ignoreScratch: false });
    write(dir, 'env-sync.conf', `${CONF}\nenv apps/server/.env.template -> apps/server/.env\n`);
    write(dir, 'apps/server/.env.template', TEMPLATE); seed(dir, VAULT);
    const r = run(dir, ['pull', '--yes']);
    assert.equal(r.status, 5); assert.match(r.stderr, /\.env-sync\.\*/); assert.ok(!exists(dir, 'apps/server/.env'));
  });
  it('exits 5 on an unknown command or option', () => {
    const dir = project();
    assert.equal(run(dir, ['frobnicate']).status, 5);
    assert.equal(run(dir, ['pull', '--nope']).status, 5);
  });
  it('defaults to pull with no arguments', () => {
    const r = run(project(), [], { input: 'n\n' });
    assert.equal(r.status, 0); assert.match(r.stdout, /Apply\?/);
  });
});

describe('env-sync.conf', () => {
  const bad = (conf) => run(project(conf), ['pull']);
  it('requires a vault', () => assert.equal(bad('env a/.env.template -> a/.env\n').status, 5));
  it('rejects a malformed env row with its line number', () => {
    const r = bad(`${CONF}env apps/server/.env.template\n`);
    assert.equal(r.status, 5); assert.match(r.stderr, /line 3/);
  });
  it('rejects an unknown entry', () => assert.match(bad(`${CONF}banana x\n`).stderr, /banana/));
  it('rejects a group- or world-readable mode', () => {
    const r = bad(`${CONF}env apps/server/.env.template -> apps/server/.env mode=644\n`);
    assert.equal(r.status, 5); assert.match(r.stderr, /owner-only/);
  });
  it('rejects a path that leaves the repo', () => {
    assert.match(bad(`${CONF}env ../evil.template -> apps/server/.env\n`).stderr, /outside the repo/);
  });
  it('ignores comments, including trailing ones', () => {
    const r = run(project(`# header | with | pipes\n${CONF}env apps/server/.env.template -> apps/server/.env  # the api\n`), ['pull', '--yes']);
    assert.equal(r.status, 0);
  });
});

describe('matching by name', () => {
  it('fills blank variables from Shared and copies settings as written', () => {
    const dir = project();
    const r = run(dir, ['pull', '--yes']);
    assert.equal(r.status, 0);
    const env = read(dir, 'apps/server/.env');
    assert.match(env, /^PORT=3011$/m);
    assert.match(env, /^CLERK_SECRET_KEY=sk_test_SEKRETclerk$/m);
    assert.match(env, /^# server$/m);
    noLeak(r);
  });
  it("prefers the app's own entry over Shared", () => {
    const dir = project(undefined, { 'Test Dev': { Shared: VAULT['Test Dev'].Shared, 'apps/server': { CLERK_SECRET_KEY: 'sk_test_SEKRETapp' } } });
    run(dir, ['pull', '--yes']);
    assert.match(read(dir, 'apps/server/.env'), /^CLERK_SECRET_KEY=sk_test_SEKRETapp$/m);
  });
  it('stops on a name 1Password does not have, lists every missing name, writes nothing', () => {
    const dir = project(); write(dir, 'apps/server/.env.template', `${TEMPLATE}CLERK_SECRET_KY=\nALSO_MISSING=\n`);
    const r = run(dir, ['pull', '--yes']);
    assert.equal(r.status, 4);
    assert.match(r.stderr, /CLERK_SECRET_KY {2}\(apps\/server\/\.env\.template\)/);
    assert.match(r.stderr, /pnpm env:add CLERK_SECRET_KY --to apps\/server\/\.env\.template/);
    assert.match(r.stderr, /pnpm env:add ALSO_MISSING --to apps\/server\/\.env\.template/);
    assert.ok(!exists(dir, 'apps/server/.env'));
    noLeak(r);
  });
  it('writes no file at all when a later file has a missing name', () => {
    const dir = project(`${CONF}env apps/server/.env.template -> apps/server/.env\nenv apps/web/.env.template -> apps/web/.env\n`);
    write(dir, 'apps/web/.env.template', 'NOT_THERE=\n');
    assert.equal(run(dir, ['pull', '--yes']).status, 4);
    assert.ok(!exists(dir, 'apps/server/.env'));
  });
  it('treats KEY="" as an intentionally empty setting, not a vault lookup', () => {
    const dir = project(); write(dir, 'apps/server/.env.template', `${TEMPLATE}REDIS_PASSWORD=""\n`);
    assert.equal(run(dir, ['pull', '--yes']).status, 0);
    assert.match(read(dir, 'apps/server/.env'), /^REDIS_PASSWORD=""$/m);
  });
  it('quotes a value that dotenv would otherwise misread', () => {
    const dir = project(undefined, { 'Test Dev': { Shared: { ...VAULT['Test Dev'].Shared, CLERK_SECRET_KEY: 'SEKRET with space #hash' } } });
    run(dir, ['pull', '--yes']);
    assert.match(read(dir, 'apps/server/.env'), /^CLERK_SECRET_KEY='SEKRET with space #hash'$/m);
  });
  it('warns by line number about lines that are not KEY=value', () => {
    const dir = project(); write(dir, 'apps/server/.env.template', `${TEMPLATE}export FOO=bar\n`);
    const r = run(dir, ['pull', '--yes']);
    assert.equal(r.status, 0); assert.match(r.stderr, /line 5/);
  });
});

describe('the diff and the prompt', () => {
  let dir;
  beforeEach(() => { dir = project(); });
  it('marks every key new for a first pull', () => {
    const r = run(dir, ['pull', '--dry-run']);
    for (const k of ['PORT', 'DATABASE_URL', 'CLERK_SECRET_KEY']) assert.match(r.stdout, new RegExp(`\\+ ${k}`));
  });
  it('classifies added, changed, removed and unchanged, by name only', () => {
    write(dir, 'apps/server/.env', 'PORT=3011\nDATABASE_URL=postgres://SEKRETlocal\nOLD_FLAG=1\n');
    const r = run(dir, ['pull', '--dry-run']);
    assert.match(r.stdout, /~ DATABASE_URL/); assert.match(r.stdout, /\+ CLERK_SECRET_KEY/);
    assert.match(r.stdout, /- OLD_FLAG/); assert.match(r.stdout, /1 unchanged/);
    noLeak(r);
  });
  it('writes on a bare "y" without --yes', () => {
    const r = run(dir, ['pull'], { input: 'y\n' });
    assert.equal(r.status, 0); assert.match(read(dir, 'apps/server/.env'), /CLERK_SECRET_KEY=/);
  });
  it('leaves the file byte-identical when the prompt is declined', () => {
    write(dir, 'apps/server/.env', 'PORT=1\n');
    const before = fs.readFileSync(path.join(dir, 'apps/server/.env'));
    run(dir, ['pull'], { input: 'n\n' });
    assert.deepEqual(fs.readFileSync(path.join(dir, 'apps/server/.env')), before);
  });
  it('asks once per file: declines the first, accepts the second', () => {
    const d = project(`${CONF}env apps/server/.env.template -> apps/server/.env\nenv apps/web/.env.template -> apps/web/.env\n`);
    write(d, 'apps/web/.env.template', 'WEB_PORT=3000\n');
    run(d, ['pull'], { input: 'n\ny\n' });
    assert.ok(!exists(d, 'apps/server/.env')); assert.ok(exists(d, 'apps/web/.env'));
  });
  it('does not write with --dry-run', () => {
    run(dir, ['pull', '--dry-run']); assert.ok(!exists(dir, 'apps/server/.env'));
  });
  it('--only restricts the run, and an unmatched --only exits 5', () => {
    const d = project(`${CONF}env apps/server/.env.template -> apps/server/.env\nenv apps/web/.env.template -> apps/web/.env\n`);
    write(d, 'apps/web/.env.template', 'WEB_PORT=3000\n');
    assert.equal(run(d, ['pull', '--yes', '--only', 'apps/web/.env']).status, 0);
    assert.ok(exists(d, 'apps/web/.env')); assert.ok(!exists(d, 'apps/server/.env'));
    assert.equal(run(d, ['pull', '--yes', '--only', 'nope/.env']).status, 5);
  });
  it('leaves no scratch directory behind', () => {
    run(dir, ['pull', '--yes']);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('.env-sync.')), []);
  });
});

describe('permissions', () => {
  it('writes 0600 by default, even over an existing 0644 file', () => {
    const dir = project(); write(dir, 'apps/server/.env', 'X=1\n'); fs.chmodSync(path.join(dir, 'apps/server/.env'), 0o644);
    run(dir, ['pull', '--yes']); assert.equal(mode(dir, 'apps/server/.env'), 0o600);
  });
  it('honours a stricter mode from the config (400 cannot come from umask)', () => {
    const dir = project(`${CONF}env apps/server/.env.template -> apps/server/.env mode=400\n`);
    run(dir, ['pull', '--yes']); assert.equal(mode(dir, 'apps/server/.env'), 0o400);
  });
  it('reports and fixes loose permissions on an otherwise up-to-date file', () => {
    const dir = project(); run(dir, ['pull', '--yes']); fs.chmodSync(path.join(dir, 'apps/server/.env'), 0o644);
    assert.equal(run(dir, ['check']).status, 1);
    run(dir, ['pull', '--yes']); assert.equal(mode(dir, 'apps/server/.env'), 0o600);
  });
});

describe('documents', () => {
  const PEM = Buffer.from('-----BEGIN PRIVATE KEY-----\nSEKRETpem\n-----END PRIVATE KEY-----\n');
  const docProject = () => project(`${CONF}file .secrets/k.pem\n`, { 'Test Dev': { 'k.pem': PEM } });
  it('writes the document by its file name, 0600, creating the directory', () => {
    const dir = docProject(); const r = run(dir, ['pull', '--yes']);
    assert.equal(r.status, 0); assert.deepEqual(fs.readFileSync(path.join(dir, '.secrets/k.pem')), PEM);
    assert.equal(mode(dir, '.secrets/k.pem'), 0o600); noLeak(r);
  });
  it('reports an unchanged document as up to date', () => {
    const dir = docProject(); run(dir, ['pull', '--yes']);
    assert.match(run(dir, ['pull', '--yes']).stdout, /up to date/);
  });
  it('exits 4 and writes nothing when the document is missing', () => {
    const dir = project(`${CONF}file .secrets/k.pem\n`, { 'Test Dev': {} });
    const r = run(dir, ['pull', '--yes']); assert.equal(r.status, 4); assert.ok(!exists(dir, '.secrets/k.pem'));
  });
});

describe('check', () => {
  it('exits 1 when the file is missing, 0 once in sync, and never writes', () => {
    const dir = project();
    const r = run(dir, ['check']); assert.equal(r.status, 1); assert.match(r.stdout, /env:pull/);
    assert.ok(!exists(dir, 'apps/server/.env'));
    run(dir, ['pull', '--yes']); assert.equal(run(dir, ['check']).status, 0);
  });
  it('exits 1 when a secret changed in 1Password', () => {
    const dir = project(); run(dir, ['pull', '--yes']);
    seed(dir, { 'Test Dev': { Shared: { ...VAULT['Test Dev'].Shared, CLERK_SECRET_KEY: 'sk_test_SEKRETrotated' } } });
    const r = run(dir, ['check']); assert.equal(r.status, 1); assert.match(r.stdout, /~ CLERK_SECRET_KEY/); noLeak(r);
  });
  it('covers documents too: missing -> 1, synced -> 0', () => {
    const dir = project(`${CONF}file .secrets/k.pem\n`, { 'Test Dev': { 'k.pem': Buffer.from('SEKRET') } });
    assert.equal(run(dir, ['check']).status, 1);
    run(dir, ['pull', '--yes']); assert.equal(run(dir, ['check']).status, 0);
  });
  it('rejects --yes, since check never writes', () => assert.equal(run(project(), ['check', '--yes']).status, 5));
});
