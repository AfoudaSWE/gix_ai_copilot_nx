import { describe, expect, it } from 'vitest';
import { assertValidToolName, isValidToolName, toolNamespaceOf } from './tool-name.js';

describe('isValidToolName', () => {
  it('accepts a single segment or namespaced dot name', () => {
    expect(isValidToolName('mathAdd')).toBe(true);
    expect(isValidToolName('math.add')).toBe(true);
    expect(isValidToolName('applications.getStatus')).toBe(true);
  });

  it('rejects names with spaces, leading digits/dots, or uppercase leading letters', () => {
    expect(isValidToolName('Not Valid')).toBe(false);
    expect(isValidToolName('.leadingDot')).toBe(false);
    expect(isValidToolName('1startsWithDigit')).toBe(false);
    expect(isValidToolName('trailingDot.')).toBe(false);
    expect(isValidToolName('')).toBe(false);
  });
});

describe('assertValidToolName', () => {
  it('throws a CopilotError-shaped validation error for an invalid name', () => {
    expect(() => assertValidToolName('bad name')).toThrow(/Invalid tool name/);
  });

  it('does not throw for a valid name', () => {
    expect(() => assertValidToolName('applications.getStatus')).not.toThrow();
  });
});

describe('toolNamespaceOf', () => {
  it('returns the leading segment(s) for a namespaced name', () => {
    expect(toolNamespaceOf('applications.getStatus')).toBe('applications');
  });

  it('returns undefined for an un-namespaced name', () => {
    expect(toolNamespaceOf('mathAdd')).toBeUndefined();
  });
});
