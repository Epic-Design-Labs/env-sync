# Security

What env-sync guarantees about your secrets, and the limits you should know about.

## Guarantees

These are pinned by the test suite, which checks every command's output for secret values.

- **No secret value is ever printed or logged.** Diffs, errors, `doctor` and `setup` show variable **names** only.
- **No secret value goes into git.** Templates hold names and plain settings. `setup` treats anything it can't classify as a secret.
- **Nothing is half-written.** Every value is fetched before any file is written. If one is missing, no file changes.
- **Files are written in one step, readable only by you** (`600` by default). Modes that let other users read a file are refused.
- **The temporary folder can't be committed.** Files pass through `.env-sync.*` at the repo root, which must be gitignored. env-sync checks this before every run and deletes the folder afterwards, including on Ctrl-C.
- **The account is pinned.** `env-sync.conf` names the 1Password account, so a second signed-in account can't answer instead.
- **The vault is only written by `setup` and `add`.** `pull`, `check` and `doctor` only read. `add` refuses to overwrite an existing value.
- **No network calls of its own.** env-sync talks only to the local `op` CLI. It has no telemetry and no dependencies.

## Limits

- **`.env` files are plaintext on your disk.** That's what a `.env` file is. env-sync makes them readable only by your user, but anything running as your user can still read them.
- **Vault access means reading all of it.** Anyone you share a vault with can read every secret in it. Share each project's vault only with that project's people.
- **Production detection is a best guess, not a guarantee.** `setup` excludes values whose name says `PROD`/`PRODUCTION`, live-mode keys (`_live_`), and databases on non-local hosts. A production secret without any of those signs would get through. Read setup's plan before running it for real.
- **`add` briefly exposes the new value to other programs on your machine.** It passes the value to `op item edit` as an argument, which can appear in the process list for a moment. That's the trade for using 1Password's additive edit, which cannot overwrite the entry's other fields.
- **`ENV_SYNC_DEBUG=1` can print data from 1Password.** Use it locally, and check its output before sharing it.

## Reporting a problem

Open an issue at https://github.com/Epic-Design-Labs/env-sync/issues. If it involves a secret being exposed, don't include the secret; describe what happened and which command you ran.
