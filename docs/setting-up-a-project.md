# Setting up a project

For the one person moving a project's existing `.env` values into 1Password. You do this **once per project**. After that, everyone uses `env:pull`.

## What you need

- The 1Password CLI, signed in (see [Getting started](getting-started.md#1-one-time-setup-on-your-machine)).
- A checkout that has the project's current `.env` files, since setup reads the values from them.
- Permission to create a vault in your 1Password account.

## 1. Install and add the scripts

```sh
npm install -D edl-env-sync      # or: pnpm add -D edl-env-sync
```

```jsonc
// package.json
"scripts": {
  "env:pull": "env-sync pull",
  "env:check": "env-sync check",
  "env:add": "env-sync add",
  "env:doctor": "env-sync doctor",
  "env:setup": "env-sync setup"
}
```

## 2. Say which files to manage (optional)

If you skip this, setup finds the gitignored `.env` files itself. It leaves out names containing `example`, `sample`, `template`, `production`, `prod` or `test`. To choose exactly, write `env-sync.conf` at the repo root first:

```
account = epicdesignlabs
vault   = Acme Dev

env  apps/api/.env.template -> apps/api/.env
env  apps/web/.env.template -> apps/web/.env.local
file .secrets/signing-key.pem
```

The format is described in full in [Configuration](configuration.md).

## 3. Rehearse

```sh
pnpm env:setup --vault "Acme Dev" --rehearse
```

A rehearsal does the whole setup against a throwaway vault named **Acme Dev (rehearsal)**. It checks that every value reads back exactly, then deletes that vault. It writes nothing to your repo. Read what it prints:

```
apps/api/.env -> apps/api/.env.template
  secrets  -> 1Password: DATABASE_URL, STRIPE_SECRET_KEY, ...
  settings -> template:  PORT, NODE_ENV, ...

Notes:
  apps/api/.env: KEY_PATH made repo-relative so it works on every machine

Excluded, because this vault is for development only:
  - apps/api/.env: STRIPE_WEBHOOK_SECRET_PROD (name says production)
```

- **secrets** go into 1Password. In the template they become blank lines like `KEY=`.
- **settings** are safe to commit and stay in the template as written.
- **excluded** means it looks like production, so it goes nowhere. If one of these is really a development value, include it explicitly: `--include KEY@apps/api/.env`.

## 4. Run it for real

The rehearsal ends by printing the exact command to run next, with your flags. Run it:

```sh
pnpm env:setup --vault "Acme Dev"
```

It creates the vault and its entries, verifies them the same way, and then writes the `.env.template` files and, if you didn't have one, `env-sync.conf`. **Review and commit them.** They contain no secret values.

## 5. Share the vault

In the 1Password app, share the vault with your teammates. They follow [Getting started](getting-started.md).

## How setup decides what's a secret

| It becomes… | When |
|---|---|
| **A secret** (in 1Password) | The name contains `KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `DSN`, `CREDENTIAL`, `PRIVATE`… or it's a connection string (`DATABASE_URL`, `postgres://…`, `redis://…`), or the value looks random. **Anything unrecognised is treated as a secret**: a setting in the vault is harmless, a secret in git is not. |
| **A setting** (in the template) | Ports, hosts, regions, buckets, paths, flags, plain URLs, IDs, and short plain values like `true` or `development`. |
| **Excluded** | The name contains `PROD`/`PRODUCTION`, the value is a live-mode key (`_live_`), or it's a database on a non-local host. |
| **Skipped** | Machine-generated values another tool owns, such as `VERCEL_OIDC_TOKEN`. |

Two more things happen automatically:

- **Absolute paths inside the repo** (for example `/Users/you/project/.secrets/key.pem`) are rewritten relative to the `.env` file, so they work on every machine.
- **When two apps have different values under the same name**, the second app gets its own entry in the vault, so neither overwrites the other.

## Other options

| Flag | Use it when |
|---|---|
| `--source <dir>` | The values live in a different checkout than the one you're writing templates into. |
| `--account <name>` | You're signed in to more than one 1Password account. |
| `--force` | Re-running setup. Without it, setup won't overwrite existing templates or add to a vault that already has entries. |
