import { describe, expect, it } from 'vitest';
import { readSettingsMessage, runtimeUrlFrom, toPreviewModel } from './settings.js';

describe('toPreviewModel', () => {
  it('maps Studio appearance settings onto @gixcopilot/ui props and CSS variables', () => {
    const model = toPreviewModel({
      'appearance.colors.primary': '#e11d2e',
      'appearance.colors.text': '#ffffff',
      'appearance.radius': '12px',
      'appearance.width': '380px',
      'appearance.theme': 'dark',
      'appearance.layout': 'sidebar',
      'appearance.position': 'bottom-left',
      'appearance.title': 'Portal Copilot',
      'appearance.placeholder': 'Ask about applications',
      'appearance.welcomeMessage': 'Hi!',
      'copilot.suggestions': ['Show my applications', 3],
      'appearance.logo': '/logo.svg',
    });
    expect(model).toMatchObject({ layout: 'sidebar', placement: 'start', theme: 'dark', title: 'Portal Copilot', suggestions: ['Show my applications'], labels: { placeholder: 'Ask about applications', emptyTitle: 'Hi!' } });
    expect(model.style).toEqual({ '--copilot-primary': '#e11d2e', '--copilot-foreground': '#ffffff', '--copilot-radius': '12px', inlineSize: '380px' });
    expect(model.unsupported).toEqual(['appearance.logo']);
  });

  it('ignores invalid values instead of injecting them into styles', () => {
    const model = toPreviewModel({ 'appearance.colors.primary': 'red; background: url(x)', 'appearance.width': 'calc(1px)', 'appearance.layout': 'script' });
    expect(model.style).toEqual({});
    expect(model.layout).toBe('embedded');
    expect(model.title).toBe('Copilot');
  });
});

describe('messages and runtime URL', () => {
  it('accepts only the Studio settings message', () => {
    expect(readSettingsMessage({ type: 'gix-preview-settings', settings: { a: 1 } })).toEqual({ a: 1 });
    expect(readSettingsMessage({ type: 'other', settings: {} })).toBeUndefined();
    expect(readSettingsMessage('x')).toBeUndefined();
  });

  it('allows only same-origin runtime paths', () => {
    expect(runtimeUrlFrom('?runtime=%2F', 'http://localhost:4000')).toBe('http://localhost:4000');
    expect(runtimeUrlFrom('?runtime=%2Fapi%2Fcopilot', 'http://localhost:4000')).toBe('http://localhost:4000/api/copilot');
    expect(runtimeUrlFrom('?runtime=https%3A%2F%2Fevil.example', 'http://localhost:4000')).toBeUndefined();
    expect(runtimeUrlFrom('?runtime=%2F%2Fevil.example', 'http://localhost:4000')).toBeUndefined();
    expect(runtimeUrlFrom('', 'http://localhost:4000')).toBeUndefined();
  });
});
