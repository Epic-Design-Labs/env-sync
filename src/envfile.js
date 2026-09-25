// .env parsing and the key-name-only diff. Nothing here ever prints a value.
export const KEY_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** Parses .env text into { order, values } where values maps key -> raw text after `=`. */
export function parseEnv(text) {
  const order = [];
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = KEY_RE.exec(line);
    if (!m) continue;
    if (!values.has(m[1])) order.push(m[1]);
    values.set(m[1], m[2]);
  }
  return { order, values };
}

/** Strips one pair of matching surrounding quotes. `"x"` and `x` are the same value. */
export function unquote(raw) {
  if (raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw.at(-1) === raw[0]) {
    return raw.slice(1, -1);
  }
  return raw;
}

/** Renders a value so dotenv reads it back unchanged. */
export function quoteValue(value) {
  if (/^[^\s#"'`$\\]*$/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Compares the current file with what would be written, by key.
 * Returns names only. Values are compared after unquoting, so `KEY="x"` and `KEY=x` match.
 */
export function diffKeys(currentText, renderedText) {
  const cur = parseEnv(currentText ?? '').values;
  const next = parseEnv(renderedText);
  const added = [];
  const changed = [];
  const removed = [];
  let unchanged = 0;
  for (const k of next.order) {
    if (!cur.has(k)) added.push(k);
    else if (unquote(cur.get(k)) !== unquote(next.values.get(k))) changed.push(k);
    else unchanged++;
  }
  for (const k of cur.keys()) if (!next.values.has(k)) removed.push(k);
  return { added, changed, removed, unchanged, same: !added.length && !changed.length && !removed.length };
}

/**
 * Splits a template into lines, classifying each:
 *   KEY=          -> { kind: 'vault', key }       filled from 1Password by name
 *   KEY=""        -> { kind: 'literal', key }     an intentionally empty value
 *   KEY=value     -> { kind: 'literal', key }     copied as written
 *   # / blank     -> { kind: 'text' }             copied as written
 *   anything else -> { kind: 'odd' }              copied, and reported by line number
 */
export function parseTemplate(text) {
  const lines = text.replace(/\r?\n$/, '').split(/\r?\n/);
  return lines.map((line, i) => {
    const m = KEY_RE.exec(line);
    if (m) return { kind: m[2] === '' ? 'vault' : 'literal', key: m[1], line, n: i + 1 };
    if (/^\s*(#|$)/.test(line)) return { kind: 'text', line, n: i + 1 };
    return { kind: 'odd', line, n: i + 1 };
  });
}
