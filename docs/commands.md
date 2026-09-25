# Commands

In a project the commands usually run through package scripts: `pnpm env:pull`, `npm run env:pull`, `yarn env:pull`. The binary itself is `env-sync`, so `npx env-sync pull` works too. `env-sync help <command>` prints a short version of each section below.

## `env-sync pull`

Writes your `.env` files and documents from 1Password. It's the default command, so a bare `env-sync` runs it.

```
env-sync pull [--yes] [--dry-run] [--only <destination>]
```

| Flag | Effect |
|---|---|
| `--yes`, `-y` | Write without asking. |
| `--dry-run` | Show what would change, and write nothing. |
| `--only <destination>` | Handle just one file, for example `--only apps/server/.env`. |

How it behaves:

- **Everything is resolved first.** If any variable or document is missing from 1Password, it lists them all and writes **no** file, not even the ones that were fine.
- For each file it shows the change by **name** (`+` new, `~` changed, `-` dropped) and asks `Apply? [y/N]`. Answering anything but `y` leaves the file exactly as it was.
- Files are written in one step with owner-only permissions (`600`, or the file's `mode=`). A file whose content is current but whose permissions are too loose gets fixed.

## `env-sync check`

Says whether your files match 1Password. It never writes.

```
env-sync check [--only <destination>]
```

Exit code **0** means everything is current. **1** means at least one file is missing, different, or has loose permissions, so run `pull`. Good for scripts and git hooks.

## `env-sync doctor`

Checks everything env-sync depends on, in order: Node, the 1Password CLI, the git repo, `env-sync.conf`, the `.gitignore` rule, sign-in, vault access, the templates, every variable and document, and whether your files are current. Each problem gets its cause and exact fix. Checks that depend on a failed one are marked *skipped*.

```
env-sync doctor
```

Exit code: **0** if everything is fine, **1** if the only problem is out-of-date files, otherwise the code of the first problem (see below).

## `env-sync add KEY`

Adds a new secret to 1Password and a blank `KEY=` line to the template, in one step.

```
env-sync add KEY [--to <template>] [--app]
```

| Flag | Effect |
|---|---|
| `--to <template>` | Which template to add it to. Needed when the project has more than one. Accepts the template or its destination. |
| `--app` | Store it in the app's own entry instead of **Shared**. Use it when this app needs a value no other app shares. |

- It asks for the value without showing it on screen. When input is piped, it reads one line.
- It refuses a name that already exists in 1Password or in the template, so it can **never overwrite** the team's current value. To change a value, edit it in 1Password.
- It reads the value back from 1Password before touching the template.
- Afterwards, commit the template. Teammates get the new value on their next `pull`.

## `env-sync setup`

One-time, per project. Moves the current `.env` values into a new vault and writes the templates. The whole process is described in [Setting up a project](setting-up-a-project.md).

```
env-sync setup [--rehearse] [--vault <name>] [--account <name>] [--source <dir>]
               [--include KEY@<destination>] [--force]
```

| Flag | Effect |
|---|---|
| `--rehearse` | Trial run in a throwaway vault, which is deleted afterwards. Writes nothing to the repo. |
| `--vault <name>` | The vault to create. Needed unless `env-sync.conf` names one. |
| `--account <name>` | Which 1Password account to use. |
| `--source <dir>` | Read the values from another checkout. |
| `--include KEY@<destination>` | Upload a key that was excluded as production-looking, for example `--include DATABASE_URL@apps/api/.env`. Repeatable. |
| `--force` | Overwrite existing templates, or add to a vault that already has entries. |

## `env-sync help`, `--help`, `--version`

`env-sync help` lists the commands. `env-sync help <command>` or `env-sync <command> --help` explains one. `env-sync --version` prints the version.

## Exit codes

The same across every command, so scripts can rely on them.

| Code | Meaning |
|---|---|
| 0 | OK. Nothing out of date. |
| 1 | `check` or `doctor` found out-of-date files, or `setup` verification failed. |
| 2 | The 1Password CLI is missing, or you're not signed in. |
| 3 | The vault can't be reached, or the project isn't set up yet. |
| 4 | A variable or document is not in 1Password. |
| 5 | A problem with the config, the arguments, or the repo (for example the `.gitignore` rule). |

## Environment variables

| Variable | Effect |
|---|---|
| `NO_COLOR` | Plain output without colour. |
| `ENV_SYNC_INTERACTIVE=1` | Offer fixes, like signing in, even when stdin isn't a terminal. |
| `ENV_SYNC_DEBUG=1` | Print full details for unexpected errors. They're hidden by default because they could contain data from 1Password. |
