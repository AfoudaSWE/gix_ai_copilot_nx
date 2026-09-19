import { describe, expect, it } from 'vitest';
import { fromOpenAIToolName, toOpenAIToolName } from './tool-name-mapping.js';

describe('tool-name-mapping', () => {
  it('encodes a single-segment canonical name unchanged (no dots to replace)', () => {
    expect(toOpenAIToolName('math')).toBe('math');
  });

  it('encodes a namespaced canonical name by replacing dots with underscores', () => {
    expect(toOpenAIToolName('applications.getStatus')).toBe('applications_getStatus');
  });

  it('encodes a multi-segment reserved tool name (Section 6/Phase 6)', () => {
    expect(toOpenAIToolName('ui.render.applicationCard')).toBe('ui_render_applicationCard');
  });

  it('round-trips every dot back exactly for names with any number of segments', () => {
    for (const name of ['math', 'applications.getStatus', 'ui.render.applicationCard', 'state.patch.applicationFilters']) {
      expect(fromOpenAIToolName(toOpenAIToolName(name))).toBe(name);
    }
  });
});
