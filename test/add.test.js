import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONF, makeRepo, read, run, seed, state, write } from './helpers.js';

function project(vault = { 'Test Dev': { Shared: { EXISTING: 'SEKRETold' } } }, rows = 'env apps/server/.env.template -> apps/server/.env\n') {
  const dir = makeRepo();
  write(dir, 'env-sync.conf', `${CONF}\n${rows}`);
  write(dir, 'apps/server/.env.template', 'PORT=3011\nEXISTING=\n');
  write(dir, 'apps/web/.env.template', 'WEB=1\n');
  seed(dir, vault);
  return dir;
}
const shared = (dir) => state(dir).vaults['Test Dev'].items.Shared?.fields;

describe('env-sync add', () => {
  it('adds the field to Shared and a blank line to the template, without echoing the value', () => {
    const dir = project();
    const r = run(dir, ['add', 'STRIPE_SECRET_KEY'], { input: 'sk_test_SEKRETnew\n' });
    assert.equal(r.status, 0, r.all);
    assert.equal(shared(dir).STRIPE_SECRET_KEY, 'sk_test_SEKRETnew');
    assert.match(read(dir, 'apps/server/.env.template'), /^STRIPE_SECRET_KEY=$/m);
    assert.ok(!r.all.includes('SEKRET'), 'value echoed');
  });
  it('the new key then renders on the next pull', () => {
    const dir = project();
    run(dir, ['add', 'STRIPE_SECRET_KEY'], { input: 'sk_test_SEKRETnew\n' });
    run(dir, ['pull', '--yes']);
    assert.match(read(dir, 'apps/server/.env'), /^STRIPE_SECRET_KEY=sk_test_SEKRETnew$/m);
  });
  it('refuses a name that already exists in 1Password, leaving it untouched', () => {
    const dir = project(); write(dir, 'apps/server/.env.template', 'PORT=3011\n');
    const r = run(dir, ['add', 'EXISTING'], { input: 'SEKRETclobber\n' });
    assert.equal(r.status, 5); assert.match(r.stderr, /already exists/);
    assert.equal(shared(dir).EXISTING, 'SEKRETold');
  });
  it('refuses a name already in the template', () => {
    assert.equal(run(project(), ['add', 'PORT'], { input: 'x\n' }).status, 5);
  });
  it('creates Shared when the vault has no entries yet', () => {
    const dir = project({ 'Test Dev': {} });
    assert.equal(run(dir, ['add', 'NEW_TOKEN'], { input: 'SEKRETfirst\n' }).status, 0);
    assert.equal(shared(dir).NEW_TOKEN, 'SEKRETfirst');
  });
  it('--app writes to the app entry instead of Shared', () => {
    const dir = project();
    run(dir, ['add', 'APP_ONLY_KEY', '--app'], { input: 'SEKRETapp\n' });
    assert.equal(state(dir).vaults['Test Dev'].items['apps/server'].fields.APP_ONLY_KEY, 'SEKRETapp');
  });
  it('needs --to when there are several templates', () => {
    const dir = project(undefined, 'env apps/server/.env.template -> apps/server/.env\nenv apps/web/.env.template -> apps/web/.env\n');
    assert.equal(run(dir, ['add', 'X_KEY'], { input: 'v\n' }).status, 5);
    assert.equal(run(dir, ['add', 'X_KEY', '--to', 'apps/web/.env.template'], { input: 'SEKRETv\n' }).status, 0);
    assert.match(read(dir, 'apps/web/.env.template'), /^X_KEY=$/m);
  });
  it('rejects an empty value and an invalid name', () => {
    assert.equal(run(project(), ['add', 'EMPTY_KEY'], { input: '\n' }).status, 5);
    assert.equal(run(project(), ['add', 'bad-name'], { input: 'v\n' }).status, 5);
  });
});
