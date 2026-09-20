import { describe, expect, it } from 'vitest';
import { jsonSchemaToZod } from './json-schema-to-zod.js';

describe('jsonSchemaToZod', () => {
  it('converts primitives with constraints', () => {
    const result = jsonSchemaToZod({ type: 'string', minLength: 2, maxLength: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.schema.safeParse('ab').success).toBe(true);
      expect(result.schema.safeParse('a').success).toBe(false);
      expect(result.schema.safeParse('abcdef').success).toBe(false);
    }
  });

  it('converts an object with required/optional fields', () => {
    const result = jsonSchemaToZod({
      type: 'object',
      properties: { id: { type: 'string' }, note: { type: 'string' } },
      required: ['id'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.schema.safeParse({ id: 'a' }).success).toBe(true);
      expect(result.schema.safeParse({}).success).toBe(false);
    }
  });

  it('converts nested arrays/objects', () => {
    const result = jsonSchemaToZod({
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.schema.safeParse([{ name: 'a' }]).success).toBe(true);
      expect(result.schema.safeParse([{}]).success).toBe(false);
    }
  });

  it('converts enums', () => {
    const result = jsonSchemaToZod({ type: 'string', enum: ['PENDING', 'APPROVED'] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.schema.safeParse('PENDING').success).toBe(true);
      expect(result.schema.safeParse('OTHER').success).toBe(false);
    }
  });

  it('converts a nullable field (OpenAPI 3.0-style and 3.1-style)', () => {
    const r30 = jsonSchemaToZod({ type: 'string', nullable: true });
    const r31 = jsonSchemaToZod({ type: ['string', 'null'] });
    expect(r30.ok && r30.schema.safeParse(null).success).toBe(true);
    expect(r31.ok && r31.schema.safeParse(null).success).toBe(true);
  });

  it('merges allOf object members', () => {
    const result = jsonSchemaToZod({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'string' } }, required: ['b'] },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.schema.safeParse({ a: 'x', b: 'y' }).success).toBe(true);
      expect(result.schema.safeParse({ a: 'x' }).success).toBe(false);
    }
  });

  it('rejects oneOf/anyOf with a clear diagnostic rather than guessing (Section 28)', () => {
    const result = jsonSchemaToZod({ oneOf: [{ type: 'string' }, { type: 'number' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.reason).toContain('oneOf/anyOf');
    }
  });

  it('rejects an unresolved $ref rather than silently producing an unknown schema', () => {
    const result = jsonSchemaToZod({ $ref: '#/components/schemas/Application' });
    expect(result.ok).toBe(false);
  });

  it('respects additionalProperties: false as a strict object', () => {
    const result = jsonSchemaToZod({ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.schema.safeParse({ a: 'x', extra: 1 }).success).toBe(false);
    }
  });

  it('allows extra properties by default (JSON Schema semantics)', () => {
    const result = jsonSchemaToZod({ type: 'object', properties: { a: { type: 'string' } } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.schema.safeParse({ a: 'x', extra: 1 }).success).toBe(true);
    }
  });
});


describe('schema conversion security regressions', () => {
  it('does not discard an earlier allOf constraint on the same property', () => {
    const result = jsonSchemaToZod({ allOf: [
      { type: 'object', properties: { name: { type: 'string', minLength: 4 } }, required: ['name'] },
      { type: 'object', properties: { name: { type: 'string', maxLength: 8 } } },
    ] });
    expect(result.ok && result.schema.safeParse({ name: 'a' }).success).toBe(false);
    expect(result.ok && result.schema.safeParse({ name: 'valid' }).success).toBe(true);
  });
  it('handles null, dictionary constraints, read-only inputs and malformed patterns', () => {
    const nullable = jsonSchemaToZod({ type: 'null' });
    expect(nullable.ok && nullable.schema.safeParse(null).success).toBe(true);
    const dictionary = jsonSchemaToZod({ type: 'object', additionalProperties: { type: 'number' } });
    expect(dictionary.ok && dictionary.schema.safeParse({ a: 'bad' }).success).toBe(false);
    const readOnly = jsonSchemaToZod({ type: 'object', properties: { id: { type: 'string', readOnly: true } }, required: ['id'] });
    expect(readOnly.ok && readOnly.schema.safeParse({}).success).toBe(true);
    expect(readOnly.ok && readOnly.schema.safeParse({ id: 'forged' }).success).toBe(false);
    expect(jsonSchemaToZod({ type: 'string', pattern: '[' }).ok).toBe(false);
    expect(jsonSchemaToZod({ type: ['number', 'string'] }).ok).toBe(false);
  });
});
