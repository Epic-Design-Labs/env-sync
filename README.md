# env-sync

Render your project's `.env` files from 1Password. Each variable is matched to the 1Password field **with the same name**, so nobody writes a path by hand and no secret ever lives in git.

```
pnpm env:pull     # write .env files from 1Password
pnpm env:check    # exit 1 if your .env files are out of date
pnpm env:add KEY  # add a new secret to 1Password and the template
pnpm env:setup    # one-time: move a project's existing values into 1Password
```

Owned by Epic Design Labs, for every EDL project. Zero dependencies, Node 20+.

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

```jsonc
// package.json
"devDependencies": {
  "@epicdesignlabs/env-sync": "github:Epic-Design-Labs/env-sync#v1.0.1"
},
"scripts": {
  "env:pull": "env-sync pull",
  "env:check": "env-sync check",
  "env:add": "env-sync add",
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
