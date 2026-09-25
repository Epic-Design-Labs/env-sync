# Troubleshooting

Start with `pnpm env:doctor`. It runs every check and prints the fix for each problem. Every message below is what env-sync actually prints, followed by what it means and how to fix it.

In a terminal, env-sync **offers** the safe fixes (signing in, adding the `.gitignore` line) and applies them only if you answer `y`.

## Signing in to 1Password

**`The 1Password CLI (op) is not installed`**
Install it: `brew install 1password-cli`. Other systems: https://developer.1password.com/docs/cli/get-started/

**`Not signed in to 1Password (account "X")`**
There's no active session for that account. Either answer `y` when env-sync offers to sign you in, or run `eval $(op signin --account X)` yourself. To use Touch ID instead of a password: 1Password → Settings → Developer → **Integrate with 1Password CLI**, and add the account to the app.

**`The 1Password app did not answer`**
CLI integration is on, but the app is closed or locked. Open 1Password and unlock it.

**`The 1Password CLI does not know the account "X"`**
The account in `env-sync.conf` isn't in the 1Password app or the CLI. Add it to the app, or run `op account add --address X.1password.com`. If the account name is wrong, fix the `account =` line.

**`The 1Password prompt was dismissed`**
Run the command again and approve the 1Password prompt.

**`Sign-in did not complete`**
The password was wrong, or sign-in was cancelled. Run `eval $(op signin --account X)` and then the command again.

## The vault

**`No access to the vault "V"`**
The vault isn't shared with you, or it doesn't exist. Ask whoever manages it to share it. 1Password gives the same answer in both cases, so the message can't tell them apart.

**`This project is not set up in 1Password yet`**
There's no vault you can see and no templates either. If you're setting the project up, run `env:setup --rehearse` and then `env:setup` ([guide](setting-up-a-project.md)). If a teammate already did, `git pull` and ask them to share the vault.

## Variables and templates

**`Not in 1Password ("V"), so nothing was written:`** followed by names
A template names variables the vault doesn't have. For each one, either add it with `env:add KEY --to <template>`, or, if the name is misspelled, fix the template. Nothing was written, including files that were fine.

**`Template missing: <paths>`**
A template listed in `env-sync.conf` isn't in your checkout. Run `git pull`. If the project has never been set up, run `env:setup`.

**`Out of date: <files>`** (from `doctor`) or `Out of date. Run: …` (from `check`)
Your local files differ from 1Password. Run `env:pull`.

## The repo and the config

**`No env-sync.conf in this repo`**
Run `git pull`. If the project has never been set up, see [Setting up a project](setting-up-a-project.md).

**`.gitignore does not cover env-sync's scratch directory`**
Add the line `.env-sync.*` to `.gitignore`, or answer `y` when env-sync offers to. Without it, a crash could leave secrets where `git add -A` would commit them.

**`Not inside a git repository`**
Run the command from inside the project's checkout.

**`env-sync.conf line N: …`**
The config has a mistake on that line. The message says what it expected, for example `expected "env <template> -> <destination>"` or `mode "644" grants group or other access`. The format is in [Configuration](configuration.md).

**`--only "X" matches no entry in env-sync.conf`**
Use one of the destinations the message lists.

**`Node X is too old (needs 20 or newer)`**
Install Node 20 or newer.

## Adding a secret

**`KEY already exists in "Shared"`**
`add` never overwrites. To change the value, edit the field in the 1Password app.

**`KEY is already in <template>`**
The template already lists it. If its value is missing from 1Password, create the field in the app.

**`Which template should KEY go in?`**
The project has several templates. Re-run with one of the `--to` commands the message lists.

## Setting up

**`VERIFICATION FAILED — the vault does not reproduce your local files`**
After uploading, a value didn't read back identically, so no templates were written. The lines below it name each key. Check those entries in 1Password and re-run with `--force`.

**`templates already exist (…). Re-run with --force to overwrite.`**
Setup has already run here. Use `--force` only if you mean to redo it.

**`"V" already has entries. Re-run with --force to add to it.`**
The vault isn't empty. Use `--force` to add to it anyway.

**`"V (rehearsal)" is left over from an earlier rehearsal`**
An earlier rehearsal was interrupted. Delete that vault with the `op vault delete` command the message shows, then rehearse again.

**`<file> looks like a production key. This vault is for development — remove it from env-sync.conf.`**
A `file` row points at something named like production. Remove the row.

## Anything else

**`unexpected <Error>. Re-run with ENV_SYNC_DEBUG=1 for details.`**
The details are hidden by default because they could include data from 1Password. Re-run with `ENV_SYNC_DEBUG=1` to see them, and **don't paste that output anywhere public** without checking it first.
