import type * as TS from 'typescript';
import { containsJsx, decoratorsOf, hasExportModifier, lineOf, parseSource, pathTemplate, staticString, walk } from './ast.js';
import type { TypeScriptApi } from './ast.js';
import type { ApiOperation, ComponentInfo, ComponentProp, ContextCandidate, ContextCandidateKind, PermissionInfo, RouteInfo } from './model.js';

type HttpVerb = ApiOperation['method'];
const VERBS: Readonly<Record<string, HttpVerb>> = { get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', delete: 'DELETE', del: 'DELETE' };
const NEST_VERBS: Readonly<Record<string, HttpVerb>> = { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE' };

/** Well-known HTTP client objects: `.get('/x', config)` on these is always a client call. */
const HTTP_CLIENTS = /^(axios|http|httpClient|ky|\$http|got|superagent|fetcher)$/i;
/** Objects whose `.get('/x')` calls an HTTP API from the client side. */
const CLIENT_OBJECTS = /(axios|http|httpclient|client|ky|\$http|request|fetcher|apiclient|api)$/i;

export const PERMISSION_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(VIEW|READ|LIST|CREATE|ADD|UPDATE|EDIT|WRITE|DELETE|REMOVE|MANAGE|APPROVE|CANCEL|ADMIN|EXPORT|ASSIGN)$/;
const PERMISSION_CONTAINER = /perm|privilege|right|scope|ability|capabilit/i;
const AUTH_HINT = /auth|jwt|guard|protect|verify|session|requireUser|requireRole|requirePermission|authorize/i;
const USER_MODEL = /^(User|CurrentUser|AuthUser|UserProfile|Principal|SessionUser|AppUser)$/;
const NON_COMPONENTS = /^(App|Root|Main|Layout|.*Layout|.*Provider|Router|.*Router|.*Routes|.*Page|.*Screen|ErrorBoundary|.*Context)$/;
/** Prop types a model can supply as data. Function props (callbacks) cannot be. */
const SERIALIZABLE_TYPE = /^(string|number|boolean|null|undefined|Date|unknown|string\[\]|number\[\]|boolean\[\]|readonly \w+\[\]|Array<\w+>|ReadonlyArray<\w+>|'[^']*'( \| '[^']*')*|"[^"]*"( \| "[^"]*")*|[A-Z]\w*(\[\])?)$/;

export interface ApiCallFinding {
  readonly kind: 'backend-route' | 'frontend-client';
  readonly method: HttpVerb;
  readonly path: string;
  readonly line: number;
  readonly permissions: readonly string[];
  readonly authenticated: boolean;
  readonly handler?: string;
}

export interface SourceFindings {
  readonly apiCalls: readonly ApiCallFinding[];
  readonly routes: readonly RouteInfo[];
  readonly components: readonly ComponentInfo[];
  readonly contextCandidates: readonly ContextCandidate[];
  readonly permissions: readonly PermissionInfo[];
  readonly userModels: readonly string[];
}

function contextKindOf(name: string): ContextCandidateKind | undefined {
  if (/^(use)?(current_?user|user|me|session|authUser|currentSession)$/i.test(name) || /^use(Auth|User|Session|CurrentUser)$/.test(name)) return 'user';
  if (/^(use)?(current)?(route|location|pathname|params|searchParams)$/i.test(name) || name === 'ActivatedRoute' || name === 'useRoute') return 'route';
  if (/^(use)?(current|selected)?(tenant|organization|org|workspace)(Id)?$/i.test(name)) return 'tenant';
  if (/^(use)?(user|current)?Permissions?$/i.test(name) || /^(use)?(has|can)Permission$/i.test(name)) return 'permissions';
  if (/^(selected|current|active)[A-Z]\w*$/.test(name)) return 'entity';
  return undefined;
}

function propsOfTypeNode(ts: TypeScriptApi, source: TS.SourceFile, typeNode: TS.TypeNode | undefined, localTypes: ReadonlyMap<string, TS.TypeNode | TS.InterfaceDeclaration>): readonly ComponentProp[] {
  if (!typeNode) return [];
  let members: readonly TS.TypeElement[] | undefined;
  if (ts.isTypeLiteralNode(typeNode)) members = typeNode.members;
  else if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const target = localTypes.get(typeNode.typeName.text);
    if (target && ts.isInterfaceDeclaration(target)) members = target.members;
    else if (target && ts.isTypeLiteralNode(target)) members = target.members;
    else if (typeNode.typeArguments?.[0]) return propsOfTypeNode(ts, source, typeNode.typeArguments[0], localTypes);
  }
  return (members ?? []).flatMap((member) => {
    if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) return [];
    const name = member.name.getText(source);
    const type = ts.isMethodSignature(member) ? '() => unknown' : (member.type?.getText(source) ?? 'unknown');
    return [{ name, type: type.replace(/\s+/g, ' '), optional: member.questionToken !== undefined }];
  });
}

function componentVerdict(name: string, exported: boolean, props: readonly ComponentProp[]): { candidate: boolean; reason: string } {
  if (!exported) return { candidate: false, reason: 'not exported' };
  if (NON_COMPONENTS.test(name)) return { candidate: false, reason: 'layout, page or provider component' };
  const callbacks = props.filter((prop) => prop.type.includes('=>') || /^on[A-Z]/.test(prop.name) || prop.name === 'children');
  if (callbacks.length > 0) return { candidate: false, reason: `takes non-data props: ${callbacks.map((prop) => prop.name).join(', ')}` };
  const unknownTypes = props.filter((prop) => !SERIALIZABLE_TYPE.test(prop.type));
  if (props.length === 0) return { candidate: false, reason: 'no typed props to validate' };
  if (unknownTypes.length > 0) return { candidate: true, reason: `data props; review types of ${unknownTypes.map((prop) => prop.name).join(', ')}` };
  return { candidate: true, reason: 'exported, data-only typed props' };
}

/** Permission identifiers mentioned inside a node (constants or `Permissions.X` accesses). */
function permissionsIn(ts: TypeScriptApi, node: TS.Node): string[] {
  const found = new Set<string>();
  walk(ts, node, (child) => {
    if (ts.isIdentifier(child) && PERMISSION_NAME.test(child.text)) found.add(child.text);
    else if ((ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) && PERMISSION_NAME.test(child.text)) found.add(child.text);
  });
  return [...found];
}

function mentionsAuth(ts: TypeScriptApi, source: TS.SourceFile, nodes: readonly TS.Node[]): boolean {
  return nodes.some((node) => !ts.isStringLiteral(node) && !ts.isFunctionLike(node) && AUTH_HINT.test(node.getText(source)));
}

function calleeObjectName(ts: TypeScriptApi, expression: TS.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return 'this';
  return undefined;
}

function methodFromInit(ts: TypeScriptApi, init: TS.Expression | undefined): HttpVerb {
  if (init && ts.isObjectLiteralExpression(init)) {
    for (const property of init.properties) {
      if (ts.isPropertyAssignment(property) && property.name.getText() === 'method') {
        const value = staticString(ts, property.initializer)?.toLowerCase();
        if (value && VERBS[value]) return VERBS[value];
      }
    }
  }
  return 'GET';
}

function objectProperty(ts: TypeScriptApi, object: TS.ObjectLiteralExpression, name: string): TS.Expression | undefined {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === name) return property.initializer;
  }
  return undefined;
}

/**
 * Analyzes one TS/JS source file. `frontend` tells the analyzer whether the file belongs to a
 * frontend unit, which decides whether `api.get('/x')` is a client call or a server route.
 */
export function analyzeSource(ts: TypeScriptApi, file: string, text: string, frontend: boolean): SourceFindings {
  const source = parseSource(ts, file, text);
  const apiCalls: ApiCallFinding[] = [];
  const routes: RouteInfo[] = [];
  const components: ComponentInfo[] = [];
  const contextCandidates: ContextCandidate[] = [];
  const permissions: PermissionInfo[] = [];
  const userModels: string[] = [];
  const localTypes = new Map<string, TS.TypeNode | TS.InterfaceDeclaration>();
  const seenContext = new Set<string>();

  walk(ts, source, (node) => {
    if (ts.isInterfaceDeclaration(node)) localTypes.set(node.name.text, node);
    else if (ts.isTypeAliasDeclaration(node)) localTypes.set(node.name.text, node.type);
  });

  const addContext = (name: string, node: TS.Node, evidence: string, kind = contextKindOf(name)): void => {
    if (!kind || seenContext.has(name)) return;
    seenContext.add(name);
    contextCandidates.push({ name, kind, file, line: lineOf(source, node), evidence });
  };

  const addReactComponent = (name: string, node: TS.Node, parameter: TS.ParameterDeclaration | undefined, exported: boolean): void => {
    let props: readonly ComponentProp[] = propsOfTypeNode(ts, source, parameter?.type, localTypes);
    if (props.length === 0 && parameter && ts.isObjectBindingPattern(parameter.name)) {
      props = parameter.name.elements.map((element) => ({ name: element.name.getText(source), type: 'unknown', optional: element.initializer !== undefined }));
    }
    components.push({ name, framework: 'react', file, line: lineOf(source, node), props, ...componentVerdict(name, exported, props) });
  };

  walk(ts, source, (node) => {
    // --- Calls: server routes, client calls, fetch, context hooks/stores -----------------
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        const verb = VERBS[callee.name.text];
        const objectName = calleeObjectName(ts, callee.expression);
        const path = verb ? pathTemplate(ts, node.arguments[0]) : undefined;
        if (verb && path && path.startsWith('/') && objectName) {
          const handlerArgs = node.arguments.slice(1);
          const hasHandler = handlerArgs.some((arg) => ts.isFunctionLike(arg) || ts.isIdentifier(arg) || ts.isPropertyAccessExpression(arg) || ts.isCallExpression(arg));
          // In a backend unit, `x.get('/path', handler)` registers a route unless `x` is a
          // known HTTP client. In a frontend unit, every such call is a client call.
          if (!frontend && hasHandler && !HTTP_CLIENTS.test(objectName)) {
            apiCalls.push({ kind: 'backend-route', method: verb, path, line: lineOf(source, node), permissions: permissionsIn(ts, node), authenticated: mentionsAuth(ts, source, handlerArgs.slice(0, -1)) });
          } else if (frontend || CLIENT_OBJECTS.test(objectName)) {
            apiCalls.push({ kind: 'frontend-client', method: verb, path, line: lineOf(source, node), permissions: [], authenticated: false });
          }
        }
        // fastify.route({ method, url })
        if (callee.name.text === 'route' && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
          const options = node.arguments[0];
          const method = staticString(ts, objectProperty(ts, options, 'method'))?.toLowerCase();
          const url = pathTemplate(ts, objectProperty(ts, options, 'url') ?? objectProperty(ts, options, 'path'));
          if (method && VERBS[method] && url) {
            apiCalls.push({ kind: 'backend-route', method: VERBS[method], path: url, line: lineOf(source, node), permissions: permissionsIn(ts, options), authenticated: AUTH_HINT.test(objectProperty(ts, options, 'preHandler')?.getText(source) ?? '') || AUTH_HINT.test(objectProperty(ts, options, 'onRequest')?.getText(source) ?? '') });
          }
        }
      } else if (ts.isIdentifier(callee)) {
        if (callee.text === 'fetch') {
          const path = pathTemplate(ts, node.arguments[0]);
          if (path?.startsWith('/')) apiCalls.push({ kind: 'frontend-client', method: methodFromInit(ts, node.arguments[1]), path, line: lineOf(source, node), permissions: [], authenticated: false });
        }
        if (/^(createContext|defineStore|createSlice|createStore|create|signalStore|createFeature)$/.test(callee.text) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
          const name = node.parent.name.text;
          addContext(name, node, `${callee.text}()`, contextKindOf(name.replace(/(Context|Store|Slice)$/, '')) ?? 'state');
        }
      }
    }

    // --- Declarations: components, context names, permissions, user models --------------
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      if (/^[A-Z]/.test(name) && node.body && containsJsx(ts, node.body)) addReactComponent(name, node, node.parameters[0], hasExportModifier(ts, node));
      else if (/^use[A-Z]/.test(name)) addContext(name, node, 'hook');
    }
    if (ts.isVariableStatement(node)) {
      const exported = hasExportModifier(ts, node);
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const name = declaration.name.text;
        const init = declaration.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && /^[A-Z]/.test(name) && containsJsx(ts, init.body)) {
          addReactComponent(name, declaration, init.parameters[0], exported);
        } else if (init && /^use[A-Z]/.test(name)) addContext(name, declaration, 'hook');
        else if (/^[a-z]/.test(name) && contextKindOf(name) && contextKindOf(name) !== 'route') addContext(name, declaration, 'variable');
        if (PERMISSION_NAME.test(name)) permissions.push({ name, file, line: lineOf(source, declaration), value: staticString(ts, init) });
        if (init && ts.isObjectLiteralExpression(init) && PERMISSION_CONTAINER.test(name)) {
          for (const property of init.properties) {
            if (!ts.isPropertyAssignment(property)) continue;
            const key = property.name.getText(source).replace(/['"]/g, '');
            permissions.push({ name: key, file, line: lineOf(source, property), value: staticString(ts, property.initializer) });
          }
        }
        // `useX()` calls bound to a context-shaped name, e.g. const user = useCurrentUser().
        if (init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && /^use[A-Z]/.test(init.expression.text)) {
          addContext(init.expression.text, declaration, 'hook call');
        }
      }
    }
    if (ts.isEnumDeclaration(node) && PERMISSION_CONTAINER.test(node.name.text)) {
      for (const member of node.members) permissions.push({ name: member.name.getText(source), file, line: lineOf(source, member), value: staticString(ts, member.initializer) });
    }
    if (ts.isTypeAliasDeclaration(node) && PERMISSION_CONTAINER.test(node.name.text) && ts.isUnionTypeNode(node.type)) {
      for (const member of node.type.types) {
        if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) permissions.push({ name: member.literal.text, file, line: lineOf(source, member), value: member.literal.text });
      }
    }
    if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node)) && node.name && USER_MODEL.test(node.name.text)) userModels.push(node.name.text);

    // --- Classes: Angular components/services, NestJS controllers -----------------------
    if (ts.isClassDeclaration(node) && node.name) {
      const decorators = decoratorsOf(ts, node);
      const component = decorators.find((decorator) => decorator.name === 'Component');
      if (component) {
        const inputs: ComponentProp[] = [];
        for (const member of node.members) {
          if (!ts.isPropertyDeclaration(member)) continue;
          const name = member.name.getText(source);
          const decoratedInput = decoratorsOf(ts, member).some((decorator) => decorator.name === 'Input');
          const init = member.initializer;
          const signalInput = init && ts.isCallExpression(init) && /^input(\.required)?$/.test(init.expression.getText(source));
          if (!decoratedInput && !signalInput) continue;
          const typeText = member.type?.getText(source) ?? (signalInput && init && ts.isCallExpression(init) ? (init.typeArguments?.[0]?.getText(source) ?? 'unknown') : 'unknown');
          inputs.push({ name, type: typeText, optional: member.questionToken !== undefined || !(signalInput && init.getText(source).includes('required')) });
        }
        components.push({ name: node.name.text, framework: 'angular', file, line: lineOf(source, node), props: inputs, ...componentVerdict(node.name.text.replace(/Component$/, ''), hasExportModifier(ts, node), inputs) });
      }
      const controller = decorators.find((decorator) => decorator.name === 'Controller');
      if (controller) {
        const prefix = staticString(ts, controller.args[0]) ?? '';
        const classGuarded = decorators.some((decorator) => decorator.name === 'UseGuards');
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          const memberDecorators = decoratorsOf(ts, member);
          const route = memberDecorators.find((decorator) => NEST_VERBS[decorator.name]);
          if (!route) continue;
          const sub = staticString(ts, route.args[0]) ?? '';
          const path = `/${[prefix, sub].filter(Boolean).join('/')}`.replace(/\/+/g, '/').replace(/:([A-Za-z_]\w*)/g, '{$1}').replace(/(.)\/$/, '$1');
          const permissionNames = memberDecorators.flatMap((decorator) => decorator.args.flatMap((arg) => permissionsIn(ts, arg)));
          apiCalls.push({ kind: 'backend-route', method: NEST_VERBS[route.name] ?? 'GET', path, line: lineOf(source, member), permissions: permissionNames, authenticated: classGuarded || memberDecorators.some((decorator) => decorator.name === 'UseGuards'), handler: member.name.getText(source) });
        }
      }
      for (const member of node.members) {
        if (ts.isPropertyDeclaration(member) || ts.isGetAccessorDeclaration(member)) {
          const name = member.name.getText(source);
          if (/^[a-z]/.test(name) && contextKindOf(name) && contextKindOf(name) !== 'route') addContext(name, member, `${node.name.text} member`);
        }
        if (ts.isConstructorDeclaration(member)) {
          for (const parameter of member.parameters) {
            if (parameter.type?.getText(source) === 'ActivatedRoute') addContext('ActivatedRoute', parameter, 'Angular router injection', 'route');
          }
        }
      }
    }

    // --- Frontend routes: <Route path>, { path, component|element } ----------------------
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === 'Route') {
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'path' && attribute.initializer && ts.isStringLiteral(attribute.initializer)) {
          routes.push({ path: attribute.initializer.text, kind: 'frontend', file, line: lineOf(source, node) });
        }
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      const path = staticString(ts, objectProperty(ts, node, 'path'));
      const target = ['component', 'element', 'loadComponent', 'loadChildren', 'children', 'redirectTo', 'Component', 'lazy'].some((key) => objectProperty(ts, node, key) !== undefined);
      if (path !== undefined && target) routes.push({ path: path.startsWith('/') || path === '' ? path || '/' : `/${path}`, kind: 'frontend', file, line: lineOf(source, node) });
    }
  });

  for (const call of apiCalls) {
    if (call.kind === 'backend-route') routes.push({ path: call.path, kind: 'backend', file, line: call.line });
  }
  return { apiCalls, routes, components, contextCandidates, permissions, userModels };
}

/** `defineProps<{...}>()` in a Vue single-file component's `<script setup lang="ts">`. */
export function analyzeVueComponent(ts: TypeScriptApi, file: string, text: string): ComponentInfo {
  const name = (file.split('/').pop() ?? file).replace(/\.vue$/, '');
  const script = /<script\b[^>]*>([\s\S]*?)<\/script>/.exec(text)?.[1] ?? '';
  const source = parseSource(ts, `${file}.ts`, script);
  let props: ComponentProp[] = [];
  const localTypes = new Map<string, TS.TypeNode | TS.InterfaceDeclaration>();
  walk(ts, source, (node) => {
    if (ts.isInterfaceDeclaration(node)) localTypes.set(node.name.text, node);
    else if (ts.isTypeAliasDeclaration(node)) localTypes.set(node.name.text, node.type);
  });
  walk(ts, source, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defineProps') {
      props = [...propsOfTypeNode(ts, source, node.typeArguments?.[0], localTypes)];
      const runtime = node.arguments[0];
      if (props.length === 0 && runtime && ts.isObjectLiteralExpression(runtime)) {
        props = runtime.properties.flatMap((property) => (ts.isPropertyAssignment(property) ? [{ name: property.name.getText(source), type: property.initializer.getText(source).replace(/^(String|Number|Boolean)$/, (m) => m.toLowerCase()), optional: true }] : []));
      }
    }
  });
  return { name, framework: 'vue', file, props, ...componentVerdict(name, true, props) };
}
