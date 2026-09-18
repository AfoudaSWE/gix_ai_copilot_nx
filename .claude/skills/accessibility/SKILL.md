---
name: accessibility
description: UI accessibility requirements - WCAG, keyboard navigation, focus management, screen readers, ARIA, reduced motion, responsive UI, RTL, and i18n readiness. Load when building any shipped UI component (React or Angular).
---

# Purpose

Ensure any UI shipped by the React or Angular SDKs is usable by everyone, not an
afterthought bolted on after visual design is finalized.

# When to Apply

Building or reviewing any shipped UI component in [[react-sdk]] or [[angular-sdk]].

# Required Rules

- Target WCAG 2.1 AA at minimum for any shipped component.
- Every interactive element is reachable and operable via keyboard alone (tab order,
  enter/space activation, escape to dismiss) — no interaction that requires a mouse/pointer.
- Focus management is explicit: opening a dialog/panel moves focus into it; closing it
  returns focus to the triggering element; focus is never silently lost or trapped
  incorrectly.
- Screen reader support: meaningful ARIA roles/labels/live-regions for dynamic content
  (e.g. streaming message text uses an appropriate live region so updates are announced
  sensibly, not read character-by-character on every token).
- Color is never the only signal for state (error, success, loading) — pair it with text,
  icon, or shape.
- Respect `prefers-reduced-motion`; animations have a reduced/no-motion fallback.
- Components are responsive and usable at minimum viable viewport widths, not desktop-only.
- Components support right-to-left (RTL) layout via logical CSS properties/direction-aware
  styling rather than hardcoded left/right assumptions.
- Text content is externalized in a way that supports future internationalization (no
  hardcoded concatenated sentence fragments that can't be reordered by a translation).

# Anti-Patterns

- A custom dropdown/dialog with no keyboard interaction, mouse-only.
- A streaming message region with no `aria-live`, so screen reader users get no feedback
  during generation.
- Error states indicated only by red text color with no icon/label.
- Hardcoded `margin-left`/`text-align: left` throughout instead of logical properties,
  breaking RTL layouts.
- An animation with no `prefers-reduced-motion` fallback.

# Validation Checklist

- [ ] Full keyboard operability verified for the component
- [ ] Focus moves and returns correctly around any dialog/overlay
- [ ] Dynamic/streaming content uses appropriate ARIA live regions
- [ ] State is never conveyed by color alone
- [ ] `prefers-reduced-motion` is respected
- [ ] Layout works under RTL direction
