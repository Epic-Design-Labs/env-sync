// Every failure the CLI reports maps to one fixed exit code. Messages never
// contain a secret value: they name keys, files, vaults and items only.
export const EXIT = Object.freeze({
  OK: 0,
  DRIFT: 1,        // `check` found a stale or missing file; also setup verification failure
  NO_OP: 2,        // 1Password CLI missing or not signed in
  NO_VAULT: 3,     // vault unreachable
  MISSING: 4,      // a variable or document is not in 1Password
  USAGE: 5,        // bad config, bad arguments, unsafe repo setup
});

export class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
