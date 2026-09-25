import fs from 'node:fs';
import { appEntry } from './config.js';
import { KEY_RE, parseTemplate } from './envfile.js';
import { CliError, EXIT } from './errors.js';
import { readSecret } from './fsutil.js';
import { cmd } from './hint.js';
import { entryLookup, SHARED } from './pull.js';

export function runAdd({ cfg, op, key, to, app, log }) {
  if (!key || !KEY_RE.test(`${key}=`)) throw new CliError(EXIT.USAGE, 'usage: env-sync add KEY [--to <template>] [--app]');
  const envRows = cfg.rows.filter((r) => r.kind === 'env');
  let row;
  if (to) {
    row = envRows.find((r) => r.template === to || r.dest === to);
    if (!row) throw new CliError(EXIT.USAGE, `--to "${to}" matches no env entry in env-sync.conf`);
  } else if (envRows.length === 1) {
    row = envRows[0];
  } else {
    throw new CliError(EXIT.USAGE, `Which template should ${key} go in?`, { fix: envRows.map((r) => cmd('add', [key, '--to', r.template])) });
  }

  const template = fs.readFileSync(row.templateAbs, 'utf8');
  if (parseTemplate(template).some((l) => l.key === key)) {
    throw new CliError(EXIT.USAGE, `${key} is already in ${row.template}`);
  }
  const entry = app ? appEntry(row) : SHARED;
  const lookup = entryLookup(op);
  for (const t of new Set([SHARED, appEntry(row)])) {
    if (lookup.get(t)?.has(key)) {
      throw new CliError(EXIT.USAGE, `${key} already exists in "${t}"`, { fix: ['To change its value, edit the field in the 1Password app. Teammates then pull.'] });
    }
  }

  const value = readSecret(`  value for ${key} (hidden): `);
  if (value === '') throw new CliError(EXIT.USAGE, 'empty value, nothing added');

  if (lookup.titles.has(entry)) op.addField(entry, key, value);
  else op.createEntry(entry, new Map([[key, value]]));
  if (op.fields(entry).get(key) !== value) {
    throw new CliError(EXIT.MISSING, `${key} did not read back from "${entry}"; check the entry in 1Password`);
  }

  fs.writeFileSync(row.templateAbs, template.replace(/\n?$/, '\n') + `${key}=\n`);
  log.out(`  created  ${entry} › ${key}`);
  log.out(`  added    ${key}= to ${row.template}`);
  log.out(`\n  Commit the template. Teammates then run: ${cmd('pull')}`);
  return EXIT.OK;
}
