# Configuration

## Models

Fields: provider, API key, model, base URL, timeout, retries. The Studio stays provider-neutral:
the host passes a factory per provider (for example `createOpenAIProvider`).

- The API key is **write-only**. `GET` and `PUT /__gix/api/config/model` return
  `{ provider, model, configured, keySource, ... }` and never the key.
- The key lives in the development server's memory for the session only. It is never written
  to disk, logged, or put in generated code. To persist it, put it in your `.env` (the Studio
  reads the variable named in `keyEnvironment`).

### Test Connection

`POST /__gix/api/config/model/test` runs `Studio → development server → existing provider
adapter → model`. The browser never calls the provider. The response contains only
`success`, `provider`, `model`, `latencyMs` and, on failure, a normalized `error`
(`code`, `message`, `retryable`) with secrets redacted.

## Copilot

Name, description, system instructions, default model (`provider:model`), welcome message,
suggestions, streaming, and attachments (only if your app implements them).

> System instructions influence model behavior. They are not a security boundary.

## Appearance

Name, title, subtitle, welcome message, placeholder, logo, assistant avatar; primary, accent,
background, surface, text, muted, border, success, warning and error colors; light/dark/system;
popup/sidebar/embedded; position, width, height, radius.

Copilot and Appearance values are validated against an allowlist (`COPILOT_SETTINGS`). Saving
them creates a **proposal** against `.gix/copilot.config.json`, which goes through the same
review and apply path as any generated change.

### Live preview and Test Copilot

The Appearance tab shows a live preview next to the form. It is the real `@gixcopilot/ui`
(`CopilotChat`, `CopilotPopup` or `CopilotSidebar`), built into `@gixcopilot/studio` and served
at `/__gix/preview/` in a same-origin frame. Edits update it as you type. Colors map onto the UI's
CSS variables (`--copilot-primary`, `--copilot-background`, `--copilot-surface`,
`--copilot-foreground`, `--copilot-muted`, `--copilot-border`, `--copilot-danger`), plus radius,
size, theme, layout, position, title, placeholder, welcome text and suggestions.

Logo, assistant avatar, and the accent, success and warning colors are saved, but
`@gixcopilot/ui` has no slot for them yet. The preview lists them as not rendered instead of
faking them.

**Test Copilot** shows the same preview with the saved configuration. With
`copilotRuntimeUrl` set (`attachStudio` sets it to `/`), messages go to the real copilot runtime
and through the Action Firewall. The browser never calls a model provider.

## Security

A read-only view of the host's existing `@gixcopilot/security` setup: Action Firewall, default
policy, approval policy, PII protection, audit, and each registered tool's security manifest.
The Studio has no security system of its own. The host supplies these facts through the
`security` and `tools` options.

## Resolved configuration

`GET /__gix/api/config` shows the configuration layers the host passes (`default`, `project`,
`environment`, `runtime`) with secrets redacted. Secret-named keys, `secrets` subtrees, URLs
with credentials and secret-shaped strings are masked. `{ secret: NAME }` references stay,
because they name a location, not a value.
