# Getting started

For anyone joining a project that already uses env-sync. You'll end up with working `.env` files without anyone sending you a secret.

## 1. One-time setup on your machine

**Install the 1Password CLI:**

```sh
brew install 1password-cli
```

Other systems: https://developer.1password.com/docs/cli/get-started/

**Recommended: let the CLI use the 1Password app.** Open 1Password → **Settings → Developer** → turn on **Integrate with 1Password CLI**, and make sure your work account is signed in to the app. After that, 1Password asks for Touch ID when env-sync needs it, and you never type a password in the terminal.

Without this, sign in in the terminal instead, once per session (about 30 minutes):

```sh
eval $(op signin --account epicdesignlabs)
```

## 2. Get access to the project's vault

Each project keeps its secrets in its own 1Password vault, for example **Throttle Dev**. The vault is named in the project's `env-sync.conf`. Ask whoever manages it to share it with you.

## 3. Pull your `.env` files

In the project:

```sh
pnpm install          # or npm install — env-sync comes in as a dev dependency
pnpm env:pull
```

`env:pull` shows what it's about to change, by variable **name** only, and asks before writing each file:

```
apps/server/.env
  + DATABASE_URL (new)
  + CLERK_SECRET_KEY (new)
  12 unchanged.
  Apply? [y/N]
```

Press `y`. That's it. You now have the same values as everyone else.

## Day to day

| You want to… | Do this |
|---|---|
| Get the latest secrets | `pnpm env:pull` |
| Check whether you're out of date | `pnpm env:check`. Exit code 1 means run `env:pull`. |
| Add a new secret for everyone | `pnpm env:add STRIPE_SECRET_KEY`, then commit the template it changed |
| Change a secret's value | Edit the field in the 1Password app. Everyone gets it on their next pull. |
| Something isn't working | `pnpm env:doctor` |

In projects that use npm, the commands are `npm run env:pull` and so on.

## When something goes wrong

Run `pnpm env:doctor`. It checks everything env-sync needs, top to bottom, and for each problem it shows what's wrong, what 1Password said, and the exact command to fix it. The full list of messages is in [Troubleshooting](troubleshooting.md).
