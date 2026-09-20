import { describe, expect, it } from 'vitest';
import { normalizeText } from './normalize.js';

describe('normalizeText', () => {
  it('converts CRLF/CR to LF', () => {
    expect(normalizeText('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('collapses more than two consecutive blank lines to one', () => {
    expect(normalizeText('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('preserves a single paragraph break', () => {
    expect(normalizeText('a\n\nb')).toBe('a\n\nb');
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalizeText('  \n hello \n  ')).toBe('hello');
  });

  it('strips non-printable control characters without touching newlines/tabs', () => {
    expect(normalizeText('a\u0000b\u0007c')).toBe('abc');
  });

  it('keeps tabs and newlines intact', () => {
    expect(normalizeText('a\tb\nc')).toBe('a\tb\nc');
  });
});
