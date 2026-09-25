# Configuration

A project commits two kinds of file: one `env-sync.conf` and one `.env.template` per `.env` file. Neither contains a secret value.

## `env-sync.conf`

At the repo root.

```
# comments start with #
account = epicdesignlabs
vault   = Throttle Dev

env  apps/server/.env.template -> apps/server/.env
env  apps/dashboard/.env.template -> apps/dashboard/.env.local  # comments can trail too
file .secrets/gr4vy-sandbox.pem
file .secrets/signing.pem mode=400
```

| Line | Meaning |
|---|---|
| `vault = <name>` | **Required.** The 1Password vault holding this project's secrets. |
| `account = <name>` | The 1Password account to use. Recommended: it stops a second signed-in account from answering by mistake. |
| `env <template> -> <destination>` | Render this template into this `.env` file. |
| `file <path>` | Write the 1Password **document** titled with this file's name (`gr4vy-sandbox.pem`) to this path. Use it for keys and certificates. |
| `mode=NNN` | Optional file permissions, `600` by default. Anything that lets other users read the file, like `644`, is refused. |

Paths are relative to the repo root and must stay inside the repo. Each destination can be listed once.

## `.env.template`

Looks like a `.env.example`: every variable the app needs.

```
# comments and blank lines are copied as-is
PORT=3011
NODE_ENV=development
DATABASE_URL=
CLERK_SECRET_KEY=
REDIS_PASSWORD=""
```

| Line | What `pull` writes |
|---|---|
| `KEY=` (blank) | The value of the 1Password field **named exactly `KEY`**. |
| `KEY=value` | `KEY=value`, unchanged. Use this for settings that aren't secret. |
| `KEY=""` | An intentionally empty value. It is not looked up. |
| `# ...` or blank | Copied unchanged. |
| Anything else | Copied unchanged, with a warning naming the line number. |

A value that contains spaces, `#`, quotes, `$` or a backslash is quoted when written, so it reads back correctly.

## How names are matched

For a blank `KEY=` in `apps/server/.env.template`, `pull` looks in the vault for:

1. an entry titled **`apps/server`** (the template's folder), and uses its `KEY` field if it has one;
2. otherwise the entry titled **`Shared`**.

A template at the repo root uses an entry titled `(root)`. If neither entry has the field, `pull` stops, lists every missing name, and writes nothing.

So a project's vault usually looks like this:

```
vault "Throttle Dev"
  Shared                 CLERK_SECRET_KEY, DATABASE_URL, RESEND_API_KEY, ...
  apps/checkout-web      CLERK_SECRET_KEY    <- only because this app needs a different value
  gr4vy-sandbox.pem      (document)
```

Put a secret in **Shared** unless one app truly needs its own value. Then it exists in one place, and rotating it is one edit.

## `.gitignore`

env-sync writes files through a short-lived folder named `.env-sync.XXXXXX` at the repo root. Your `.gitignore` must include:

```
.env-sync.*
```

`setup` adds this line for you. The other commands refuse to run without it, and in a terminal they offer to add it.
