// Suggest commands in the form the person actually uses: `pnpm env:pull`,
// `npm run env:pull`, `yarn env:pull`, or `npx env-sync pull` outside a script.
const agent = () => (process.env.npm_config_user_agent || '').split('/')[0];

export function cmd(sub, args = []) {
  const tail = args.length ? ` ${args.join(' ')}` : '';
  switch (agent()) {
    case 'pnpm': return `pnpm env:${sub}${tail}`;
    case 'yarn': return `yarn env:${sub}${tail}`;
    case 'npm': return `npm run env:${sub}${tail ? ` --${tail}` : ''}`;
    default: return `npx env-sync ${sub}${tail}`;
  }
}
