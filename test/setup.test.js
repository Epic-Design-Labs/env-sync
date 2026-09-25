import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { classify } from '../src/classify.js';
import { CONF, exists, makeRepo, read, run, state, write } from './helpers.js';

describe('classify, on the real Throttle and DispatchTickets key names', () => {
  const k = (key, value) => classify(key, value).kind;
  const cases = [
    ['PORT', '3011', 'literal'], ['NODE_ENV', 'development', 'literal'], ['LOG_LEVEL', 'debug', 'literal'],
    ['RATE_LIMIT_WINDOW_MS', '60000', 'literal'], ['THROTTLE_S3_BUCKET', 'throttle-dev', 'literal'],
    ['GR4VY_PRIVATE_KEY_PATH', '/x/.secrets/k.pem', 'literal'], ['AUTH_USE_MERCHANT_MEMBERS', 'true', 'literal'],
    ['GR4VY_SANDBOX_ID', 'epic-design-labs', 'literal'], ['THROTTLE_API_URL', 'http://localhost:3011', 'literal'],
    ['NEXT_PUBLIC_CLERK_SIGN_IN_URL', '/sign-in', 'literal'], ['THROTTLE_APPLICATION_ID', '6f1c2b3a-4d5e-6f70-8192-a3b4c5d6e7f8', 'literal'],
    ['GOOGLE_CLIENT_ID', 'x.apps.googleusercontent.com', 'literal'], ['S3_ENDPOINT', 'http://localhost:9000', 'literal'],
    ['DATABASE_URL', 'postgresql://u:p@localhost:5433/db', 'secret'], ['REDIS_URL', 'redis://localhost:6379', 'secret'],
    ['CLERK_SECRET_KEY', 'sk_test_abc', 'secret'], ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_abc', 'secret'],
    ['AWS_ACCESS_KEY_ID', 'AKIAABCDEFGHIJKLMNOP', 'secret'], ['AWS_SECRET_ACCESS_KEY', 'short', 'secret'],
    ['CUSTOMER_AUTH_TOKEN_SECRET', 'x', 'secret'], ['SENTRY_DSN', 'https://k@o1.ingest.sentry.io/1', 'secret'],
    ['REDIS_PASSWORD', 'p', 'secret'], ['POSTMARK_SERVER_TOKEN', 't', 'secret'],
    ['GR4VY_SANDBOX_ID', 'abc123def456ghi789jkl012mno', 'secret'],
    ['SOMETHING_NEW', 'Zx9#pl!q', 'secret'],
    ['GR4VY_PRODUCTION_WEBHOOK_SECRET', 'x', 'excluded'], ['THROTTLE_API_KEY', 'sk_live_abc', 'excluded'],
    ['DATABASE_URL', 'postgresql://u:p@dt-db.render.com:5432/dt', 'excluded'], ['VERCEL_OIDC_TOKEN', 'eyJx', 'skipped'],
  ];
  for (const [key, value, want] of cases) it(`${key} -> ${want}`, () => assert.equal(k(key, value), want));
  it('--include overrides a production false positive', () => {
    assert.equal(classify('DATABASE_URL', 'postgresql://u:p@dev-db.render.com/x', { include: true }).kind, 'secret');
  });
});

function project({ withConf = true } = {}) {
  const dir = makeRepo();
  const pem = path.join(dir, '.secrets/gr4vy-sandbox.pem');
  write(dir, 'apps/server/.env', [
    'DATABASE_URL=postgresql://u:SEKRETdb@localhost:5433/x', 'PORT=3011', `GR4VY_PRIVATE_KEY_PATH=${pem}`,
    'CLERK_SECRET_KEY="sk_test_SEKRETclerk"', 'GR4VY_PRODUCTION_WEBHOOK_SECRET=SEKRETprod', 'REDIS_PASSWORD=', 'NEW_THING=SEKRET!!odd#1', '',
  ].join('\n'));
  write(dir, 'apps/dashboard/.env.local', 'CLERK_SECRET_KEY=sk_test_SEKRETclerk\nNEXT_PUBLIC_DASHBOARD_URL=http://localhost:3002\n');
  write(dir, 'apps/demo/.env.local', 'CLERK_SECRET_KEY=sk_test_SEKRETdifferent\n');
  write(dir, '.env.local', 'VERCEL_OIDC_TOKEN=eyJSEKRET.x\n');
  write(dir, '.secrets/gr4vy-sandbox.pem', '-----BEGIN KEY-----\nSEKRETpem\n-----END KEY-----\n');
  if (withConf) {
    write(dir, 'env-sync.conf', `${CONF}
env apps/server/.env.template -> apps/server/.env
env apps/dashboard/.env.template -> apps/dashboard/.env.local
env apps/demo/.env.template -> apps/demo/.env.local
file .secrets/gr4vy-sandbox.pem
`);
  }
  return dir;
}
const vaults = (dir) => Object.keys(state(dir).vaults);
const items = (dir, v = 'Test Dev') => state(dir).vaults[v].items;
const noLeak = (r) => assert.ok(!r.all.includes('SEKRET'), `a secret leaked:\n${r.all}`);

describe('env-sync setup', () => {
  it('rehearsal: builds, verifies and deletes a throwaway vault, and writes nothing', () => {
    const dir = project();
    const r = run(dir, ['setup', '--rehearse']);
    assert.equal(r.status, 0, r.all);
    assert.match(r.stdout, /verification clean/);
    assert.deepEqual(vaults(dir), []);
    assert.ok(!exists(dir, 'apps/server/.env.template'));
    noLeak(r);
  });
  it('real run: one Shared entry, an own entry only for the app that disagrees, and the document', () => {
    const dir = project();
    const r = run(dir, ['setup']);
    assert.equal(r.status, 0, r.all); noLeak(r);
    const it_ = items(dir);
    assert.equal(it_.Shared.fields.CLERK_SECRET_KEY, 'sk_test_SEKRETclerk');
    assert.equal(it_['apps/demo'].fields.CLERK_SECRET_KEY, 'sk_test_SEKRETdifferent');
    assert.ok(!('apps/dashboard' in it_), 'dashboard agrees with Shared, so it gets no entry');
    assert.ok(it_['gr4vy-sandbox.pem'].doc);
  });
  it('templates hold names and settings only, no secret values', () => {
    const dir = project(); run(dir, ['setup']);
    const t = read(dir, 'apps/server/.env.template');
    assert.ok(!t.includes('SEKRET'));
    assert.match(t, /^DATABASE_URL=$/m); assert.match(t, /^CLERK_SECRET_KEY=$/m); assert.match(t, /^PORT=3011$/m);
    assert.match(t, /^GR4VY_PRIVATE_KEY_PATH=\.\.\/\.\.\/\.secrets\/gr4vy-sandbox\.pem$/m);
    assert.match(t, /^REDIS_PASSWORD=""$/m);
    assert.ok(!t.includes('GR4VY_PRODUCTION'), 'production key must be left out');
  });
  it('reports exclusions, portable paths and the disagreeing app by name', () => {
    const r = run(project(), ['setup', '--rehearse']);
    assert.match(r.stdout, /GR4VY_PRODUCTION_WEBHOOK_SECRET \(name says production\)/);
    assert.match(r.stdout, /GR4VY_PRIVATE_KEY_PATH made repo-relative/);
    assert.match(r.stdout, /"apps\/demo" gets its own value/);
  });
  it('the real pull then reproduces the local values', () => {
    const dir = project(); run(dir, ['setup']);
    const orig = read(dir, 'apps/dashboard/.env.local');
    fs.rmSync(path.join(dir, 'apps/dashboard/.env.local'));
    assert.equal(run(dir, ['pull', '--yes']).status, 0);
    assert.equal(read(dir, 'apps/dashboard/.env.local').replace(/^#.*\n|^\n/gm, ''), orig);
    assert.equal(run(dir, ['check', '--only', 'apps/dashboard/.env.local']).status, 0);
  });
  it('refuses to overwrite existing templates or a populated vault without --force', () => {
    const dir = project(); run(dir, ['setup']);
    const r = run(dir, ['setup']); assert.equal(r.status, 5); assert.match(r.stderr, /--force/);
  });
  it('refuses a production key listed in env-sync.conf', () => {
    const dir = project(); write(dir, '.secrets/gr4vy-production.pem', 'x');
    fs.appendFileSync(path.join(dir, 'env-sync.conf'), 'file .secrets/gr4vy-production.pem\n');
    assert.equal(run(dir, ['setup', '--rehearse']).status, 5);
  });
  it('without env-sync.conf: finds the gitignored .env files, skips the generated one, writes the conf', () => {
    const dir = project({ withConf: false });
    const r = run(dir, ['setup', '--vault', 'Test Dev', '--account', 'epicdesignlabs']);
    assert.equal(r.status, 0, r.all);
    const conf = read(dir, 'env-sync.conf');
    assert.match(conf, /^vault\s+= Test Dev$/m);
    assert.match(conf, /^env\s+apps\/server\/\.env\.template -> apps\/server\/\.env$/m);
    assert.match(conf, /apps\/dashboard\/\.env\.template -> apps\/dashboard\/\.env\.local/);
    assert.match(r.stdout, /VERCEL_OIDC_TOKEN skipped/);
  });
  it('--source reads the values from another checkout, writes templates here', () => {
    const src = project();
    const dir = makeRepo();
    fs.copyFileSync(path.join(src, 'env-sync.conf'), path.join(dir, 'env-sync.conf'));
    const r = run(dir, ['setup', '--source', src]);
    assert.equal(r.status, 0, r.all);
    assert.ok(exists(dir, 'apps/server/.env.template')); assert.ok(!exists(dir, 'apps/server/.env'));
  });
  it('adds .env-sync.* to .gitignore when missing', () => {
    const dir = makeRepo({ ignoreScratch: false }); write(dir, 'apps/x/.env', 'PORT=1\n');
    fs.appendFileSync(path.join(dir, '.gitignore'), 'apps/x/.env\n');
    const r = run(dir, ['setup', '--vault', 'Test Dev', '--rehearse']);
    assert.equal(r.status, 0, r.all); assert.match(read(dir, '.gitignore'), /^\.env-sync\.\*$/m);
  });
  it('stops cleanly when signed out, writing nothing', () => {
    const dir = project();
    const r = run(dir, ['setup'], { env: { FAKE_OP_SIGNED_OUT: '1' } });
    assert.equal(r.status, 2); assert.deepEqual(vaults(dir), []); assert.ok(!exists(dir, 'apps/server/.env.template'));
  });
});

describe('failure paths that must stay loud and quiet at once', () => {
  it('setup reports VERIFICATION FAILED when the vault does not hold what was sent', () => {
    const dir = project();
    const r = run(dir, ['setup'], { env: { FAKE_OP_CORRUPT_CREATE: '1' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /VERIFICATION FAILED/);
    assert.match(r.stdout, /CLERK_SECRET_KEY does not match your local value/);
    assert.ok(!exists(dir, 'apps/server/.env.template'), 'no templates are written after a failed verification');
    noLeak(r);
  });
  it('garbled op output never leaks the secret it contains into the error', () => {
    const dir = project(); run(dir, ['setup']);
    const r = run(dir, ['pull', '--yes'], { env: { FAKE_OP_GARBLE_GET: '1' } });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unexpected output from 1Password/);
    noLeak(r);
  });
});
