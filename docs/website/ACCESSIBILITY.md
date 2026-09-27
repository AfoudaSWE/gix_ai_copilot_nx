# Accessibility

Target: WCAG 2.1 AA.

- Semantic landmarks, one `<h1>` per page, a skip link and visible focus rings.
- Focus moves to the new page heading after client-side navigation.
- Dropdowns follow the disclosure pattern: Enter or ArrowDown opens, arrow keys move, Esc closes
  and returns focus. The mobile menu, docs drawer and search are modal dialogs that manage focus.
- Tabs follow the WAI-ARIA tabs pattern (arrow keys, Home/End, roving tab index, RTL-aware).
- Code blocks are focusable regions with labelled copy and wrap buttons; a successful copy is
  announced.
- Demos have text equivalents, never depend on animation, and show their final state under
  reduced motion. All motion respects `prefers-reduced-motion`.
- All text meets AA contrast in both themes; status colors are darker in the light theme.
- RTL: layouts use logical properties, and code always stays left-to-right.

`tests/browser/website.spec.ts` runs axe (WCAG 2.0/2.1 A and AA rules) on the homepage, docs home,
a guide, an API page, the enterprise and examples pages in dark mode, two pages in light mode, and
the search dialog. It also checks keyboard navigation, phone-width overflow and RTL overflow.
