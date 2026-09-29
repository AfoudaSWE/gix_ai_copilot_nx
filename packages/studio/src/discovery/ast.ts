import type * as TS from 'typescript';

export type TypeScriptApi = typeof TS;

let cached: Promise<TypeScriptApi | undefined> | undefined;

/**
 * Loads the TypeScript compiler from the consumer's own install (optional peer dependency).
 * Discovery parses source with it (§17 "do not rely exclusively on regex"); when it is
 * missing, discovery reports a diagnostic instead of pretending AST analysis ran.
 */
export function loadTypeScript(): Promise<TypeScriptApi | undefined> {
  cached ??= import('typescript').then(
    // typescript is CommonJS: Node exposes it as the default export.
    (module) => (module.default as TypeScriptApi | undefined) ?? module,
    () => undefined,
  );
  return cached;
}

export function parseSource(ts: TypeScriptApi, file: string, text: string): TS.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

export function lineOf(source: TS.SourceFile, node: TS.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** A string literal's text, or undefined for anything that is not a static string. */
export function staticString(ts: TypeScriptApi, node: TS.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

/**
 * Turns a URL-ish expression into an API path template: `'/a/' + id`, `` `${base}/a/${id}` ``
 * and `'/a/:id'` all become `/a/{id}`. A leading expression before the first `/` (a base URL
 * variable) is dropped. Returns undefined when no static path segment exists.
 */
export function pathTemplate(ts: TypeScriptApi, node: TS.Node | undefined): string | undefined {
  if (!node) return undefined;
  const parts: string[] = [];
  const nameOf = (expression: TS.Expression): string => {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    return 'param';
  };
  const collect = (expression: TS.Node): void => {
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) parts.push(expression.text);
    else if (ts.isTemplateExpression(expression)) {
      parts.push(expression.head.text);
      for (const span of expression.templateSpans) {
        parts.push(`{${nameOf(span.expression)}}`);
        parts.push(span.literal.text);
      }
    } else if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      collect(expression.left);
      collect(expression.right);
    } else if (ts.isParenthesizedExpression(expression)) collect(expression.expression);
    else parts.push(`{${ts.isExpression(expression) ? nameOf(expression) : 'param'}}`);
  };
  collect(node);
  // Drop an absolute origin, then a leading base-URL placeholder before the first `/`.
  let path = parts.join('').replace(/^https?:\/\/[^/]+/, '');
  const firstSlash = path.indexOf('/');
  if (firstSlash < 0) return undefined;
  path = path.slice(firstSlash).replace(/:([A-Za-z_][\w]*)/g, '{$1}').replace(/\?.*$/, '');
  if (!/[A-Za-z]/.test(path)) return undefined;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

export function walk(ts: TypeScriptApi, node: TS.Node, visit: (node: TS.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(ts, child, visit));
}

export function hasExportModifier(ts: TypeScriptApi, node: TS.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

export function decoratorsOf(ts: TypeScriptApi, node: TS.Node): readonly { readonly name: string; readonly args: readonly TS.Expression[] }[] {
  const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
  return (decorators ?? []).flatMap((decorator): { readonly name: string; readonly args: readonly TS.Expression[] }[] => {
    const expression = decorator.expression;
    if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) return [{ name: expression.expression.text, args: expression.arguments }];
    if (ts.isIdentifier(expression)) return [{ name: expression.text, args: [] }];
    return [];
  });
}

export function containsJsx(ts: TypeScriptApi, node: TS.Node): boolean {
  let found = false;
  const visit = (child: TS.Node): void => {
    if (found) return;
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}
