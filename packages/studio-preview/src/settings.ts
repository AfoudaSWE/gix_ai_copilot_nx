import type { CSSProperties } from 'react';

/** Flat dot-path settings as the Studio edits them, e.g. `appearance.colors.primary`. */
export type StudioSettings = Readonly<Record<string, unknown>>;

export interface PreviewModel {
  readonly layout: 'embedded' | 'popup' | 'sidebar';
  readonly placement: 'start' | 'end';
  readonly theme: 'light' | 'dark' | 'system';
  readonly title: string;
  readonly suggestions: readonly string[];
  readonly labels: { readonly placeholder?: string; readonly emptyTitle?: string; readonly emptyDescription?: string };
  readonly style: CSSProperties & Record<`--${string}`, string>;
  /** Settings the Studio stores but @gixcopilot/ui has no slot for yet; shown, never faked. */
  readonly unsupported: readonly string[];
}

/** Studio color keys → the CSS variables @gixcopilot/ui reads. */
const COLOR_VARIABLES: Readonly<Record<string, string>> = {
  primary: '--copilot-primary',
  background: '--copilot-background',
  surface: '--copilot-surface',
  text: '--copilot-foreground',
  muted: '--copilot-muted',
  border: '--copilot-border',
  error: '--copilot-danger',
};
const UNSUPPORTED = ['appearance.logo', 'appearance.assistantAvatar', 'appearance.colors.accent', 'appearance.colors.success', 'appearance.colors.warning'];

const HEX = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
const LENGTH = /^\d{1,4}(px|rem|em|vh|vw|%)$/;

const text = (settings: StudioSettings, key: string): string | undefined => {
  const value = settings[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
};

/**
 * Maps Studio settings onto the real `@gixcopilot/ui` props. Values are re-validated here
 * (colors, lengths, enums) because the preview only ever receives them over postMessage.
 */
export function toPreviewModel(settings: StudioSettings): PreviewModel {
  const style: Record<string, string> = {};
  for (const [key, variable] of Object.entries(COLOR_VARIABLES)) {
    const value = text(settings, `appearance.colors.${key}`);
    if (value && HEX.test(value)) style[variable] = value;
  }
  const radius = text(settings, 'appearance.radius');
  if (radius && /^\d{1,3}(px|rem)$/.test(radius)) style['--copilot-radius'] = radius;
  const width = text(settings, 'appearance.width');
  if (width && LENGTH.test(width)) style['inlineSize'] = width;
  const height = text(settings, 'appearance.height');
  if (height && LENGTH.test(height)) style['blockSize'] = height;

  const layout = settings['appearance.layout'];
  const theme = settings['appearance.theme'];
  const position = text(settings, 'appearance.position') ?? 'bottom-right';
  const suggestions = settings['copilot.suggestions'];
  const placeholder = text(settings, 'appearance.placeholder');
  const welcome = text(settings, 'appearance.welcomeMessage') ?? text(settings, 'copilot.welcomeMessage');
  const subtitle = text(settings, 'appearance.subtitle');
  return {
    layout: layout === 'popup' || layout === 'sidebar' ? layout : 'embedded',
    placement: /left/.test(position) ? 'start' : 'end',
    theme: theme === 'dark' || theme === 'light' ? theme : 'system',
    title: text(settings, 'appearance.title') ?? text(settings, 'appearance.name') ?? text(settings, 'copilot.name') ?? 'Copilot',
    suggestions: Array.isArray(suggestions) ? suggestions.filter((entry): entry is string => typeof entry === 'string').slice(0, 10) : [],
    labels: { ...(placeholder ? { placeholder } : {}), ...(welcome ? { emptyTitle: welcome } : {}), ...(subtitle ? { emptyDescription: subtitle } : {}) },
    style: style,
    unsupported: UNSUPPORTED.filter((key) => text(settings, key) !== undefined),
  };
}

/** The message the Studio page sends; anything else is ignored. */
export function readSettingsMessage(data: unknown): StudioSettings | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const message = data as { type?: unknown; settings?: unknown };
  if (message.type !== 'gix-preview-settings' || typeof message.settings !== 'object' || message.settings === null) return undefined;
  return message.settings as StudioSettings;
}

/** A runtime URL may only be a same-origin path (the page CSP allows `connect-src 'self'`). */
export function runtimeUrlFrom(search: string, origin: string): string | undefined {
  const value = new URLSearchParams(search).get('runtime');
  if (value === null || !value.startsWith('/') || value.startsWith('//')) return undefined;
  return new URL(value, origin).href.replace(/\/$/, '');
}
