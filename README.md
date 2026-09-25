# env-sync

Render your project's `.env` files from 1Password. Each variable is matched to the 1Password field **with the same name**, so nobody writes a path by hand and no secret ever lives in git.

```
pnpm env:pull     # write .env files from 1Password
pnpm env:check    # exit 1 if your .env files are out of date
pnpm env:add KEY  # add a new secret to 1Password and the template
pnpm env:doctor   # check your setup, and show how to fix each problem
pnpm env:setup    # one-time: move a project's existing values into 1Password
```

Owned by Epic Design Labs, for every EDL project. Zero dependencies, Node 20+.

## Documentation

The full guides ship with the package, in [`docs/`](docs/README.md), which is also at `node_modules/edl-env-sync/docs/` once installed. `env-sync help <command>` gives the short version in your terminal.

- [Getting started](docs/getting-started.md): joining a project that already uses env-sync
- [Setting up a project](docs/setting-up-a-project.md): moving a project's secrets into 1Password
- [Configuration](docs/configuration.md): `env-sync.conf` and `.env.template`
- [Commands](docs/commands.md): every command, flag and exit code
- [Troubleshooting](docs/troubleshooting.md): every error message and its fix
- [Security](docs/security.md): what it guarantees about your secrets, and the limits

## How it works

Each repo commits two kinds of file.

**`env-sync.conf`** says which 1Password account and vault the project uses, and which files to fill:

```
account = epicdesignlabs
vault   = Throttle Dev

env  apps/server/.env.template -> apps/server/.env
env  apps/dashboard/.env.template -> apps/dashboard/.env.local
file .secrets/gr4vy-sandbox.pem
```

**`.env.template`** reads like a `.env.example`: every variable the app needs, with the secret ones left blank.

```
PORT=3011
NODE_ENV=development
DATABASE_URL=
CLERK_SECRET_KEY=
```

`env-sync pull` fills each blank variable from the field of the same name. It looks in the app's own entry first (titled after the template's directory, such as `apps/server`), then in the vault's **Shared** entry. Lines with a value, like `PORT=3011`, are copied as written. `KEY=""` is an intentionally empty setting.

| In the vault "Throttle Dev" | Holds |
|---|---|
| **Shared** | every secret, as a field named like its variable. One place to rotate each. |
| **apps/demo-store** *(only if needed)* | values for that app that differ from Shared |
| **gr4vy-sandbox.pem** | a document, written to the path in the `file` row |

`file` rows fetch the 1Password document titled with the file's name.

## Install

```
npm install -D edl-env-sync      # or: pnpm add -D edl-env-sync
```

Then add the scripts to `package.json`:

```jsonc
"scripts": {
  "env:pull": "env-sync pull",
  "env:check": "env-sync check",
  "env:add": "env-sync add",
  "env:doctor": "env-sync doctor",
  "env:setup": "env-sync setup"
}
```

You also need the [1Password CLI](https://developer.1password.com/docs/cli/get-started/) with **Settings → Developer → Integrate with 1Password CLI** turned on in the desktop app, and `.env-sync.*` in your `.gitignore`. `setup` adds that line for you.

## Everyday use

| You want to… | Do this | Then everyone else |
|---|---|---|
| Start on a project | get access to its vault, then `pnpm env:pull` | — |
| Rotate a secret | edit the field in 1Password | `pnpm env:pull` |
| Add a secret | `pnpm env:add STRIPE_SECRET_KEY`, then commit the template | `pnpm env:pull` |
| Check you're current | `pnpm env:check` | — |

`add` asks for the value without showing it, refuses a name that already exists (so it can never overwrite the team's value), and writes to Shared. Use `--app` to write to the app's own entry instead, and `--to <template>` when the repo has more than one.

There is deliberately no push from a laptop to the vault. It would let one person's stale value overwrite the one everyone uses.

## Setting up a new project

Run it once, in the checkout that holds the current values:

```
pnpm env:setup --vault "Acme Dev" --rehearse   # dry run in a throwaway vault, deleted afterwards
pnpm env:setup --vault "Acme Dev"              # for real
```

`setup` reads each `.env` file, listed in `env-sync.conf` or found among your gitignored files, and decides for each key:

- **secret → 1Password**: names like `*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, connection strings, and anything that looks random. Unknown keys are treated as secrets, the safe direction.
- **setting → template**: ports, hosts, regions, paths, flags, plain URLs.
- **excluded**: anything that looks like production. That means a name containing `PROD`/`PRODUCTION`, a `_live_` key, or a database on a non-local host. The vault is for development. Override a false positive with `--include KEY@path/to/.env`.
- **made portable**: absolute paths inside the repo are rewritten relative to the `.env` file, so they work on every machine.

When two apps hold different values under one name, the second app gets its own entry. Before writing a single template, `setup` renders every template back from 1Password and checks each value against your file. Nothing it prints ever contains a secret value. Use `--source <dir>` to read values from a different checkout.

## When something is wrong

Run `pnpm env:doctor`. It checks everything the tool depends on, top to bottom, and for each problem shows what is wrong, what 1Password actually said, and the exact command that fixes it, using your own account and vault names. Checks that depend on a failed one are marked skipped rather than piling up follow-on errors.

```
  ✓ Node 20.20.2 (needs 20+)
  ✓ 1Password CLI 2.39.0
  ✗ Not signed in to 1Password (account "epicdesignlabs")
      1Password said: You are not currently signed in.
      Fix: eval $(op signin --account epicdesignlabs)
           Or use Touch ID instead of a password: 1Password → Settings → Developer →
           "Integrate with 1Password CLI", and add your epicdesignlabs account to the app.
  · Vault "Throttle Dev"  (skipped until signed in)
```

Every other command runs the same checks first and stops at the first problem with the same explanation. In a terminal, a problem with a safe local fix is offered and applied only if you answer yes: **signing in** (it runs the 1Password sign-in for you and keeps the session for that run, so there's no `eval`) and **adding the `.gitignore` rule**. Anything involving other people, such as vault access, is only explained. With no terminal attached, as in CI, nothing prompts.

| You see | What it means | Fix |
|---|---|---|
| Not signed in to 1Password | no session for the account in `env-sync.conf` | answer yes when asked, or `eval $(op signin --account <account>)` |
| The 1Password app did not answer | CLI integration is on, but the app is locked or closed | open and unlock the app |
| The 1Password CLI does not know the account | the account isn't in the app or the CLI | add it in the app, or `op account add --address <account>.1password.com` |
| No access to the vault | the vault isn't shared with you, or doesn't exist yet | ask its owner, or create it with `env:setup` |
| Template missing | the template isn't in your checkout | `git pull` |
| Not in 1Password | a template names a variable the vault doesn't have | `pnpm env:add KEY --to <template>`, or fix the typo |

Hints use the command you actually ran with: `pnpm env:pull`, `npm run env:pull`, `yarn env:pull`, or `npx env-sync pull`.

## Guarantees

- **No secret value is printed, logged or written to git.** Diffs show key names only.
- **Nothing is written unless everything resolves.** If any variable is missing from 1Password, `pull` names all of them and writes no file.
- **Writes are atomic and owner-only.** Files are rendered into a scratch directory in the repo and renamed into place. The default mode is `600`, and a mode that grants group or world access is refused.
- **Declining a prompt changes nothing.**
- **The 1Password account is pinned** by `env-sync.conf`, so a second signed-in account can never answer by mistake.

`add` passes the new value to `op item edit` as an argument, which briefly makes it visible in the local process list. That's the trade for using 1Password's additive edit, which can't rewrite the rest of the entry.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | ok, nothing out of date |
| 1 | `check` found an out-of-date file, or `setup` verification failed |
| 2 | 1Password CLI missing or signed out |
| 3 | vault unreachable |
| 4 | a variable or document is not in 1Password |
| 5 | bad config or arguments, or an unsafe repo setup |

## Development

```
npm test
```

The tests run the real CLI against a fake `op` (`test/fake-op/op`). No network, no vault.
