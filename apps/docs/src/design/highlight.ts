/**
 * A small, dependency-free syntax highlighter for the languages these docs use (TypeScript,
 * JavaScript, JSX, JSON, shell, YAML, CSS, HTML/Vue templates, SQL). It tokenizes; it never
 * produces HTML strings, so rendering stays React-escaped.
 */
export type TokenType = 'keyword' | 'string' | 'number' | 'comment' | 'function' | 'type' | 'punct' | 'prompt' | 'plain';
export interface Token {
  readonly type: TokenType;
  readonly text: string;
}

const JS_KEYWORDS = new Set(
  'abstract as async await break case catch class const continue declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of private protected public readonly return satisfies set static super switch this throw true try type typeof undefined var void while yield'.split(' '),
);
const SQL_KEYWORDS = new Set('select from where insert into values update set delete create table index on and or not null primary key references alter add drop as join left right inner limit order by group having returning with'.split(' '));
const SHELL_COMMANDS = new Set('npm npx pnpm yarn bun node cd cp mkdir docker git curl aicopilot export echo cat rm'.split(' '));

type Rule = readonly [RegExp, TokenType | ((match: string) => TokenType)];

const JS_RULES: readonly Rule[] = [
  [/^\/\/[^\n]*/, 'comment'],
  [/^\/\*[\s\S]*?\*\//, 'comment'],
  [/^`(?:\\[\s\S]|[^`\\])*`/, 'string'],
  [/^'(?:\\.|[^'\\\n])*'/, 'string'],
  [/^"(?:\\.|[^"\\\n])*"/, 'string'],
  [/^\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?n?\b/i, 'number'],
  [/^[A-Za-z_$][\w$]*(?=\s*(?:<[^>\n]*>)?\s*\()/, (word) => (JS_KEYWORDS.has(word) ? 'keyword' : 'function')],
  [/^[A-Z][\w$]*/, 'type'],
  [/^[A-Za-z_$][\w$]*/, (word) => (JS_KEYWORDS.has(word) ? 'keyword' : 'plain')],
  [/^(?:=>|[{}()[\];,.<>:?=+\-*/%!&|^~@])/, 'punct'],
];

const JSON_RULES: readonly Rule[] = [
  [/^"(?:\\.|[^"\\\n])*"(?=\s*:)/, 'function'],
  [/^"(?:\\.|[^"\\\n])*"/, 'string'],
  [/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i, 'number'],
  [/^(?:true|false|null)\b/, 'keyword'],
  [/^[{}[\],:]/, 'punct'],
];

const SHELL_RULES: readonly Rule[] = [
  [/^#[^\n]*/, 'comment'],
  [/^'[^'\n]*'/, 'string'],
  [/^"(?:\\.|[^"\\\n])*"/, 'string'],
  [/^--?[\w-]+/, 'keyword'],
  [/^\$\{?\w+\}?/, 'type'],
  [/^[\w@./:^-]+/, (word) => (SHELL_COMMANDS.has(word) ? 'function' : 'plain')],
  [/^[|&;<>=]/, 'punct'],
];

const YAML_RULES: readonly Rule[] = [
  [/^#[^\n]*/, 'comment'],
  [/^[\w.-]+(?=\s*:(?:\s|$))/, 'function'],
  [/^'[^'\n]*'/, 'string'],
  [/^"(?:\\.|[^"\\\n])*"/, 'string'],
  [/^-?\d+(?:\.\d+)?\b/, 'number'],
  [/^(?:true|false|null|yes|no)\b/, 'keyword'],
  [/^[:\-[\]{},|>]/, 'punct'],
];

const CSS_RULES: readonly Rule[] = [
  [/^\/\*[\s\S]*?\*\//, 'comment'],
  [/^--[\w-]+/, 'type'],
  [/^[\w-]+(?=\s*:)/, 'function'],
  [/^#[0-9a-f]{3,8}\b/i, 'number'],
  [/^-?\d+(?:\.\d+)?(?:px|rem|em|%|ms|s|vw|vh|fr|deg)?/, 'number'],
  [/^'[^'\n]*'|^"[^"\n]*"/, 'string'],
  [/^[{}():;,>]/, 'punct'],
];

const HTML_RULES: readonly Rule[] = [
  [/^<!--[\s\S]*?-->/, 'comment'],
  [/^<\/?[\w-]+/, 'keyword'],
  [/^\/?>/, 'keyword'],
  [/^[\w:@.-]+(?==)/, 'function'],
  [/^"[^"]*"|^'[^']*'/, 'string'],
];

const SQL_RULES: readonly Rule[] = [
  [/^--[^\n]*/, 'comment'],
  [/^'(?:''|[^'])*'/, 'string'],
  [/^\d+(?:\.\d+)?\b/, 'number'],
  [/^[A-Za-z_][\w]*/, (word) => (SQL_KEYWORDS.has(word.toLowerCase()) ? 'keyword' : 'plain')],
  [/^[(),;.*=<>]/, 'punct'],
];

const LANGUAGES: Readonly<Record<string, readonly Rule[]>> = {
  ts: JS_RULES,
  tsx: JS_RULES,
  typescript: JS_RULES,
  js: JS_RULES,
  jsx: JS_RULES,
  javascript: JS_RULES,
  mjs: JS_RULES,
  json: JSON_RULES,
  jsonc: JS_RULES,
  bash: SHELL_RULES,
  sh: SHELL_RULES,
  shell: SHELL_RULES,
  console: SHELL_RULES,
  yaml: YAML_RULES,
  yml: YAML_RULES,
  css: CSS_RULES,
  html: HTML_RULES,
  vue: HTML_RULES,
  xml: HTML_RULES,
  sql: SQL_RULES,
  dockerfile: SHELL_RULES,
};

export const LANGUAGE_LABEL: Readonly<Record<string, string>> = { ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX', json: 'JSON', bash: 'Shell', sh: 'Shell', shell: 'Shell', yaml: 'YAML', yml: 'YAML', css: 'CSS', html: 'HTML', vue: 'Vue', sql: 'SQL', text: 'Text' };

export function tokenize(code: string, language = 'text'): Token[] {
  const rules = LANGUAGES[language.toLowerCase()];
  if (!rules) return [{ type: 'plain', text: code }];
  const tokens: Token[] = [];
  let rest = code;
  let plain = '';
  const flush = (): void => {
    if (plain) tokens.push({ type: 'plain', text: plain });
    plain = '';
  };
  outer: while (rest.length > 0) {
    // Shell prompts at the start of a line.
    if (rules === SHELL_RULES && /^\$ /.test(rest) && (tokens.length === 0 && !plain ? true : (plain || tokens.at(-1)?.text || '').endsWith('\n'))) {
      flush();
      tokens.push({ type: 'prompt', text: '$ ' });
      rest = rest.slice(2);
      continue;
    }
    for (const [pattern, type] of rules) {
      const match = pattern.exec(rest);
      if (match && match[0].length > 0) {
        flush();
        const text = match[0];
        tokens.push({ type: typeof type === 'function' ? type(text) : type, text });
        rest = rest.slice(text.length);
        continue outer;
      }
    }
    plain += rest[0];
    rest = rest.slice(1);
  }
  flush();
  return tokens;
}

/** Splits tokens into lines (tokens spanning newlines are split) for line numbers/highlights. */
export function toLines(tokens: readonly Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines[lines.length - 1]?.push({ type: token.type, text: part });
    });
  }
  return lines;
}

/** Parses a fence meta string such as `title="server.ts" {2,4-6}`. */
export function parseMeta(meta: string | undefined): { title?: string; highlight: Set<number> } {
  const highlight = new Set<number>();
  if (!meta) return { highlight };
  const title = /(?:title|file(?:name)?)=["']([^"']+)["']/.exec(meta)?.[1];
  const ranges = /\{([\d,\s-]+)\}/.exec(meta)?.[1];
  for (const range of ranges?.split(',') ?? []) {
    const [from, to] = range.trim().split('-').map(Number);
    if (from === undefined || Number.isNaN(from)) continue;
    for (let line = from; line <= (to ?? from); line += 1) highlight.add(line);
  }
  return { title, highlight };
}
