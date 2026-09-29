import { z } from 'zod';

const color = z.string().regex(/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/, 'a hex color such as #e11d2e');
const cssLength = z.string().regex(/^\d{1,4}(px|rem|em|vh|vw|%)$/, 'a CSS length such as 380px');
const text = (max: number) => z.string().max(max);
const imageUrl = z.string().max(2000).refine((value) => value === '' || value.startsWith('/') || /^https:\/\//.test(value), 'an https URL or a path starting with /');

/**
 * Every Appearance (§7) and Copilot (§10) setting the Studio can save, by dot path. A key
 * outside this list is rejected, so the Studio can only propose known, typed settings.
 */
export const COPILOT_SETTINGS: Readonly<Record<string, z.ZodType>> = {
  'appearance.name': text(80),
  'appearance.title': text(120),
  'appearance.subtitle': text(200),
  'appearance.welcomeMessage': text(2000),
  'appearance.placeholder': text(200),
  'appearance.logo': imageUrl,
  'appearance.assistantAvatar': imageUrl,
  'appearance.colors.primary': color,
  'appearance.colors.accent': color,
  'appearance.colors.background': color,
  'appearance.colors.surface': color,
  'appearance.colors.text': color,
  'appearance.colors.muted': color,
  'appearance.colors.border': color,
  'appearance.colors.success': color,
  'appearance.colors.warning': color,
  'appearance.colors.error': color,
  'appearance.theme': z.enum(['light', 'dark', 'system']),
  'appearance.layout': z.enum(['popup', 'sidebar', 'embedded']),
  'appearance.position': z.enum(['bottom-right', 'bottom-left', 'top-right', 'top-left', 'right', 'left']),
  'appearance.width': cssLength,
  'appearance.height': cssLength,
  'appearance.radius': z.string().regex(/^\d{1,3}(px|rem)$/),
  'copilot.name': text(80),
  'copilot.description': text(500),
  'copilot.systemInstructions': text(20_000),
  'copilot.defaultModel': z.string().regex(/^[a-z][a-z0-9-]*:[\w.:-]+$/, 'provider:model, e.g. openai:gpt-4o-mini'),
  'copilot.welcomeMessage': text(2000),
  'copilot.suggestions': z.array(text(200)).max(10),
  'copilot.streaming': z.boolean(),
  'copilot.attachments': z.boolean(),
};

export const copilotSettingsSchema = z
  .record(z.string(), z.unknown())
  .superRefine((values, context) => {
    for (const [key, value] of Object.entries(values)) {
      const schema = COPILOT_SETTINGS[key];
      if (!schema) {
        context.addIssue({ code: 'custom', path: [key], message: 'Unknown setting.' });
        continue;
      }
      const result = schema.safeParse(value);
      if (!result.success) context.addIssue({ code: 'custom', path: [key], message: result.error.issues[0]?.message ?? 'Invalid value.' });
    }
  });

/** Shown next to the system-instructions field (§10). */
export const SYSTEM_INSTRUCTIONS_NOTICE = 'System instructions influence model behavior. They are not a security boundary.';
