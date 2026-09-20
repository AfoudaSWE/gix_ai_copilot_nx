import { describe, expect, it } from 'vitest';
import { toToolNameSegment } from './tool-name-segment.js';

describe('toToolNameSegment', () => {
  it('lowercases the first character of an already-camelCase/PascalCase name', () => {
    expect(toToolNameSegment('ApplicationCard')).toBe('applicationCard');
    expect(toToolNameSegment('applicationCard')).toBe('applicationCard');
  });

  it('converts kebab-case into camelCase', () => {
    expect(toToolNameSegment('application-filters')).toBe('applicationFilters');
  });

  it('converts snake_case into camelCase', () => {
    expect(toToolNameSegment('application_filters')).toBe('applicationFilters');
  });

  it('strips other separators (spaces, dots) while still camelCasing across them', () => {
    expect(toToolNameSegment('application filters')).toBe('applicationFilters');
    expect(toToolNameSegment('application.filters')).toBe('applicationFilters');
  });
});
