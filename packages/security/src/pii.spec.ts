import { describe, expect, it } from 'vitest';
import { createFieldRedactionDataPolicy, defaultRedactor, redactFields } from './pii.js';

describe('defaultRedactor', () => {
  it('masks the middle of a string, keeping the first and last two characters (Section 54 example)', () => {
    expect(defaultRedactor('A12345678')).toBe('A******78');
  });

  it('fully masks a short string rather than leaking any of it', () => {
    expect(defaultRedactor('abcd')).toBe('****');
  });

  it('replaces a non-string value outright', () => {
    expect(defaultRedactor(12345678)).toBe('[REDACTED]');
  });
});

describe('redactFields', () => {
  it('redacts a top-level field, leaving others untouched', () => {
    const data = { name: 'Ahmed Fouda', passport: 'A12345678' };
    const result = redactFields(data, [{ field: 'passport', classification: 'pii' }]);
    expect(result).toEqual({ name: 'Ahmed Fouda', passport: 'A******78' });
  });

  it('redacts a nested dotted-path field without mutating the input', () => {
    const data = { applicant: { name: 'Ahmed Fouda', passport: 'A12345678' } };
    const result = redactFields(data, [{ field: 'applicant.passport', classification: 'pii' }]);
    expect(result).toEqual({ applicant: { name: 'Ahmed Fouda', passport: 'A******78' } });
    expect(data.applicant.passport).toBe('A12345678'); // Original untouched.
  });

  it('supports a custom redactor per field', () => {
    const data = { email: 'a@example.com' };
    const result = redactFields(data, [
      { field: 'email', classification: 'pii', redact: () => '[email hidden]' },
    ]);
    expect(result).toEqual({ email: '[email hidden]' });
  });

  it('silently skips a field that is absent from the data', () => {
    const data = { name: 'Ahmed' };
    expect(redactFields(data, [{ field: 'ssn', classification: 'pii' }])).toEqual(data);
  });
});

describe('createFieldRedactionDataPolicy', () => {
  it('redacts an object payload per configured specs (Section 137 flow)', () => {
    const policy = createFieldRedactionDataPolicy([{ field: 'passport', classification: 'pii' }]);
    expect(policy.redact({ name: 'Ahmed Fouda', passport: 'A12345678' })).toEqual({
      name: 'Ahmed Fouda',
      passport: 'A******78',
    });
  });

  it('passes through non-object data unchanged', () => {
    const policy = createFieldRedactionDataPolicy([{ field: 'x', classification: 'pii' }]);
    expect(policy.redact('plain string')).toBe('plain string');
    expect(policy.redact(null)).toBe(null);
  });
});
