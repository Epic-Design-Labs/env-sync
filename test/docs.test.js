import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { makeRepo, run } from './helpers.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const pages = ['README.md', ...fs.readdirSync(DOCS).map((f) => `docs/${f}`)];

describe('the shipped documentation', () => {
  it('every relative link between the guides points at a file that exists', () => {
    const broken = [];
    for (const page of pages) {
      const text = fs.readFileSync(path.join(ROOT, page), 'utf8');
      for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        const file = target.split('#')[0];
        if (!fs.existsSync(path.resolve(path.dirname(path.join(ROOT, page)), file))) broken.push(`${page} -> ${target}`);
      }
    }
    assert.deepEqual(broken, []);
  });
  it('every command has a section in commands.md', () => {
    const text = fs.readFileSync(path.join(DOCS, 'commands.md'), 'utf8');
    for (const c of ['pull', 'check', 'doctor', 'add KEY', 'setup']) assert.match(text, new RegExp(`## \`env-sync ${c}\``));
  });
  it('the npm package ships the docs folder', () => {
    const [info] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8' }));
    const shipped = info.files.map((f) => f.path);
    for (const f of fs.readdirSync(DOCS)) assert.ok(shipped.includes(`docs/${f}`), `docs/${f} not in the package`);
    assert.ok(!shipped.some((f) => f.startsWith('test/')), 'tests should not ship');
  });
});

describe('env-sync help', () => {
  const dir = makeRepo();
  it('lists the commands and where the docs are', () => {
    const r = run(dir, ['help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /env-sync help <command>/);
    const docsPath = /Docs: (\S+) /.exec(r.stdout)[1];
    assert.ok(fs.existsSync(path.join(docsPath, 'getting-started.md')), 'the printed docs path must exist');
  });
  for (const c of ['pull', 'check', 'doctor', 'add', 'setup']) {
    it(`help ${c} and ${c} --help both explain it`, () => {
      const a = run(dir, ['help', c]); const b = run(dir, [c, '--help']);
      assert.equal(a.status, 0); assert.equal(b.status, 0);
      assert.match(a.stdout, new RegExp(`^env-sync ${c}`)); assert.equal(a.stdout, b.stdout);
    });
  }
  it('works on a machine without 1Password or git', () => {
    const r = run(dir, ['pull', '--help'], { env: { PATH: '/nonexistent' } });
    assert.equal(r.status, 0); assert.match(r.stdout, /--dry-run/);
  });
  it('an unknown topic is exit 5 with the list of commands', () => {
    const r = run(dir, ['help', 'nope']);
    assert.equal(r.status, 5); assert.match(r.stderr, /pull, check, doctor, add, setup/);
  });
});
