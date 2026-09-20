import { z } from 'zod';

/**
 * Converts a practical, bounded subset of JSON Schema (Section 27 of the Phase 8 brief) into
 * a Zod schema, shared by `@gixcopilot/openapi` (OpenAPI parameter/request-body schemas) and
 * `@gixcopilot/mcp` (MCP tool input schemas) - both external tool sources need the exact same
 * "validate before execution, never trust the source's own schema" guarantee every other tool
 * in this SDK already has (Section 29's "avoid duplicating validation logic"), so this lives
 * once, here, rather than being reimplemented per source package.
 *
 * Deliberately conservative: a schema shape this function cannot represent *safely* returns
 * `{ ok: false }` with a diagnostic instead of guessing (Section 28) - callers (an OpenAPI
 * operation, an MCP tool) are expected to skip that one candidate rather than register a tool
 * whose validation silently doesn't match its real input shape.
 */
export interface JsonSchemaConversionIssue {
  readonly path: string;
  readonly reason: string;
}

export type JsonSchemaConversionResult =
  | { readonly ok: true; readonly schema: z.ZodType }
  | { readonly ok: false; readonly issues: readonly JsonSchemaConversionIssue[] };

/** Structural shape this converter reads - deliberately not the full JSON Schema/OpenAPI
 * Schema Object type, so callers don't need a specific spec-version's type imported here. */
export interface JsonSchemaLike {
  readonly type?: string | readonly string[];
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly nullable?: boolean; // OpenAPI 3.0-style
  readonly properties?: Readonly<Record<string, JsonSchemaLike>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | JsonSchemaLike;
  readonly items?: JsonSchemaLike;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number | boolean;
  readonly exclusiveMaximum?: number | boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly pattern?: string;
  readonly format?: string;
  readonly description?: string;
  readonly default?: unknown;
  readonly readOnly?: boolean;
  readonly writeOnly?: boolean;
  readonly allOf?: readonly JsonSchemaLike[];
  readonly oneOf?: readonly JsonSchemaLike[];
  readonly anyOf?: readonly JsonSchemaLike[];
  readonly $ref?: string;
}

function typesOf(schema: JsonSchemaLike): readonly string[] {
  const { type } = schema;
  if (type === undefined) return [];
  if (typeof type === 'string') return [type];
  return type;
}

function isNullable(schema: JsonSchemaLike): boolean {
  return schema.nullable === true || typesOf(schema).includes('null');
}

function primaryType(schema: JsonSchemaLike): string | undefined {
  return typesOf(schema).find((candidate) => candidate !== 'null');
}

function convertString(schema: JsonSchemaLike): z.ZodType {
  let s = z.string();
  if (schema.minLength !== undefined) s = s.min(schema.minLength);
  if (schema.maxLength !== undefined) s = s.max(schema.maxLength);
  if (schema.pattern !== undefined) s = s.regex(new RegExp(schema.pattern));
  if (schema.format === 'email') s = s.email();
  if (schema.format === 'uri' || schema.format === 'url') s = s.url();
  if (schema.format === 'uuid') s = s.uuid();
  if (schema.format === 'date') s = s.date();
  if (schema.format === 'date-time') s = s.datetime({ offset: true });
  return s;
}

function convertNumber(schema: JsonSchemaLike, integer: boolean): z.ZodType {
  let n = z.number();
  if (integer) n = n.int();
  if (schema.minimum !== undefined) n = n.min(schema.minimum);
  if (schema.maximum !== undefined) n = n.max(schema.maximum);
  if (typeof schema.exclusiveMinimum === 'number') n = n.gt(schema.exclusiveMinimum);
  if (typeof schema.exclusiveMaximum === 'number') n = n.lt(schema.exclusiveMaximum);
  return n;
}

function convert(
  schema: JsonSchemaLike,
  path: string,
  issues: JsonSchemaConversionIssue[],
  direction: 'input' | 'output',
): z.ZodType | undefined {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    issues.push({ path, reason: 'Only schema objects are supported.' }); return undefined;
  }
  const supported = new Set(['type', 'enum', 'const', 'nullable', 'properties', 'required', 'additionalProperties', 'items', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'format', 'description', 'default', 'allOf', 'oneOf', 'anyOf', '$ref', 'readOnly', 'writeOnly', 'title', 'examples', 'example', 'deprecated', '$schema', '$id', '$defs']);
  const unsupported = Object.keys(schema).filter((key) => !supported.has(key) && !key.startsWith('x-'));
  if (unsupported.length || typesOf(schema).filter((type) => type !== 'null').length > 1) {
    issues.push({ path, reason: `Unsupported schema constraints: ${unsupported.join(', ') || 'type union'}.` }); return undefined;
  }
  if (schema.$ref !== undefined) {
    issues.push({ path, reason: `Unresolved $ref "${schema.$ref}" - references must be resolved before conversion.` });
    return undefined;
  }
  if (schema.oneOf !== undefined || schema.anyOf !== undefined) {
    issues.push({ path, reason: 'oneOf/anyOf composition is not supported - provide an override or exclude this operation.' });
    return undefined;
  }
  if (schema.allOf !== undefined) {
    if (schema.allOf.length === 0) { issues.push({ path, reason: 'Empty allOf is unsupported.' }); return undefined; }
    const { allOf, ...siblings } = schema;
    const branches = Object.keys(siblings).length ? [...allOf, siblings] : allOf;
    const members = branches.map((member, index) => convert(member, `${path}.allOf[${String(index)}]`, issues, direction));
    if (members.some((member) => member === undefined)) return undefined;
    return (members as z.ZodType[]).reduce((acc, member) => z.intersection(acc, member));
  }

  if (schema.enum !== undefined || schema.const !== undefined) {
    const values = schema.enum ?? [schema.const];
    if (!values.length || values.some((value) => value !== null && !['string', 'number', 'boolean'].includes(typeof value))) {
      issues.push({ path, reason: 'Only nonempty primitive enums/const values are supported.' }); return undefined;
    }
    const literal = z.literal(values as [string | number | boolean | null, ...(string | number | boolean | null)[]]);
    const { enum: _enum, const: _const, ...rest } = schema;
    if (rest.type !== undefined || rest.properties !== undefined) {
      const base = convert(rest, path, issues, direction);
      return base ? z.intersection(base, literal) : undefined;
    }
    return literal;
  }

  const type = primaryType(schema);
  if (!type && typesOf(schema).includes('null')) return z.null();
  let result: z.ZodType;
  switch (type) {
    case 'string':
      result = convertString(schema);
      break;
    case 'number':
      result = convertNumber(schema, false);
      break;
    case 'integer':
      result = convertNumber(schema, true);
      break;
    case 'boolean':
      result = z.boolean();
      break;
    case 'array': {
      if (!schema.items) {
        issues.push({ path, reason: 'Array schema is missing "items".' });
        return undefined;
      }
      const item = convert(schema.items, `${path}[]`, issues, direction);
      if (!item) return undefined;
      let arr = z.array(item);
      if (schema.minItems !== undefined) arr = arr.min(schema.minItems);
      if (schema.maxItems !== undefined) arr = arr.max(schema.maxItems);
      result = arr;
      break;
    }
    case 'object':
    case undefined: {
      const shape: Record<string, z.ZodType> = {};
      const properties = schema.properties ?? {};
      const required = new Set(schema.required ?? []);
      for (const [key, propertySchema] of Object.entries(properties)) {
        if ((direction === 'input' && propertySchema.readOnly) || (direction === 'output' && propertySchema.writeOnly)) {
          shape[key] = direction === 'input' ? z.never().optional() : z.unknown().optional().transform(() => undefined); continue;
        }
        const converted = convert(propertySchema, `${path}.${key}`, issues, direction);
        if (!converted) return undefined;
        shape[key] = required.has(key) ? converted : converted.optional();
      }
      const object = z.object(shape);
      if (schema.additionalProperties === false) result = object.strict();
      else if (typeof schema.additionalProperties === 'object') {
        const extra = convert(schema.additionalProperties, `${path}.*`, issues, direction);
        if (!extra) return undefined;
        result = object.catchall(extra);
      } else result = object.passthrough();
      break;
    }
    default:
      issues.push({ path, reason: `Unsupported schema type "${String(type)}".` });
      return undefined;
  }

  if (schema.description) result = result.describe(schema.description);
  return isNullable(schema) ? result.nullable() : result;
}

export function jsonSchemaToZod(schema: JsonSchemaLike, direction: 'input' | 'output' = 'input'): JsonSchemaConversionResult {
  const issues: JsonSchemaConversionIssue[] = [];
  let result: z.ZodType | undefined;
  try { result = convert(schema, '$', issues, direction); }
  catch { issues.push({ path: '$', reason: 'Malformed or excessively recursive schema.' }); }
  if (!result || issues.length > 0) {
    return { ok: false, issues: issues.length > 0 ? issues : [{ path: '$', reason: 'Unsupported schema.' }] };
  }
  return { ok: true, schema: result };
}
