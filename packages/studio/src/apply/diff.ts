/**
 * A minimal unified diff (§48) with no dependency: an LCS over lines, grouped into hunks with
 * three lines of context. Large inputs fall back to a whole-file replacement hunk so a huge
 * file cannot make the Studio quadratic.
 */
const CONTEXT = 3;
const MAX_CELLS = 4_000_000;

type Op = { readonly kind: ' ' | '-' | '+'; readonly text: string };

function lineOps(before: readonly string[], after: readonly string[]): Op[] {
  if (before.length * after.length > MAX_CELLS) return [...before.map((text) => ({ kind: '-' as const, text })), ...after.map((text) => ({ kind: '+' as const, text }))];
  const rows = before.length + 1;
  const cols = after.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = before[i] === after[j] ? (table[(i + 1) * cols + j + 1] ?? 0) + 1 : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + j + 1] ?? 0);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      ops.push({ kind: ' ', text: before[i] ?? '' });
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + j + 1] ?? 0)) {
      ops.push({ kind: '-', text: before[i] ?? '' });
      i += 1;
    } else {
      ops.push({ kind: '+', text: after[j] ?? '' });
      j += 1;
    }
  }
  while (i < before.length) ops.push({ kind: '-', text: before[i++] ?? '' });
  while (j < after.length) ops.push({ kind: '+', text: after[j++] ?? '' });
  return ops;
}

const splitLines = (text: string | undefined): string[] => (text === undefined || text === '' ? [] : text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));

export function unifiedDiff(path: string, before: string | undefined, after: string | undefined): string {
  const ops = lineOps(splitLines(before), splitLines(after));
  const header = [`--- ${before === undefined ? '/dev/null' : `a/${path}`}`, `+++ ${after === undefined ? '/dev/null' : `b/${path}`}`];
  const changed = ops.map((op, index) => (op.kind === ' ' ? -1 : index)).filter((index) => index >= 0);
  if (changed.length === 0) return '';
  const hunks: string[] = [];
  let start = 0;
  while (start < changed.length) {
    let end = start;
    while (end + 1 < changed.length && (changed[end + 1] ?? 0) - (changed[end] ?? 0) <= CONTEXT * 2) end += 1;
    const from = Math.max(0, (changed[start] ?? 0) - CONTEXT);
    const to = Math.min(ops.length, (changed[end] ?? 0) + CONTEXT + 1);
    const slice = ops.slice(from, to);
    const oldStart = ops.slice(0, from).filter((op) => op.kind !== '+').length + 1;
    const newStart = ops.slice(0, from).filter((op) => op.kind !== '-').length + 1;
    const oldCount = slice.filter((op) => op.kind !== '+').length;
    const newCount = slice.filter((op) => op.kind !== '-').length;
    hunks.push(`@@ -${String(oldCount === 0 ? oldStart - 1 : oldStart)},${String(oldCount)} +${String(newCount === 0 ? newStart - 1 : newStart)},${String(newCount)} @@`, ...slice.map((op) => `${op.kind}${op.text}`));
    start = end + 1;
  }
  return [...header, ...hunks].join('\n');
}
