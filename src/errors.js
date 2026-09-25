// Every failure maps to one fixed exit code and is shown the same way:
// what is wrong, what 1Password actually said, and the exact fix.
// Messages never contain a secret value.
export const EXIT = Object.freeze({
  OK: 0,
  DRIFT: 1,        // `check` found a stale or missing file; also setup verification failure
  NO_OP: 2,        // 1Password CLI missing or not signed in
  NO_VAULT: 3,     // vault unreachable
  MISSING: 4,      // a variable or document is not in 1Password
  USAGE: 5,        // bad config, bad arguments, unsafe repo setup
});

export class CliError extends Error {
  /**
   * @param {number} code      exit code
   * @param {string} message   what is wrong, in one line where possible
   * @param {{said?: string, fix?: string[], autofix?: {prompt: string, run: () => void}}} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.said = details.said ?? null;
    this.fix = details.fix ?? [];
    this.autofix = details.autofix ?? null;
  }
}

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const mark = { ok: paint(32, '✓'), fail: paint(31, '✗'), skip: paint(90, '·'), warn: paint(33, '!') };

/** First line of op's stderr, without its "[ERROR] <timestamp>" prefix. */
export function opSaid(stderr) {
  const line = (stderr || '').trim().split('\n').find(Boolean) ?? '';
  return line.replace(/^\[ERROR\]\s*(\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d\s*)?/, '').trim() || null;
}

/** The problem/cause/fix block every command prints on failure. */
export function formatProblem(e, indent = '  ') {
  const out = [`${indent}${mark.fail} ${e.message.split('\n')[0]}`];
  for (const l of e.message.split('\n').slice(1)) out.push(`${indent}    ${l}`);
  if (e.said) out.push(`${indent}    1Password said: ${e.said}`);
  e.fix.forEach((l, i) => out.push(`${indent}    ${i === 0 ? 'Fix: ' : '     '}${l}`));
  return out.join('\n');
}
