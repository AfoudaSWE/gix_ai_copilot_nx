# GIX design system

Everything visual comes from `apps/docs/src/design/`:

| File | Contents |
| --- | --- |
| `tokens.css` | Palette (`--gix-*`), semantic tokens (`--bg`, `--surface*`, `--text*`, `--accent*`, `--border*`), type scale, spacing, radius, motion and syntax colors; dark by default, light under `[data-theme='light']` |
| `base.css` | Reset, typography, focus rings, buttons, badges, cards, section headings, code windows, tabs, callouts, motion and reduced motion |
| `components.tsx` | `GixWordmark` (logo placeholder), `GixButton`, `GixBadge`, `FeatureStatus`, `GixCard`, `CardGrid`, `GixSectionHeading`, `GixGradientText`, `Tabs`, `Callout`, `Steps`, `Accordion`, `GixArchitectureNode` |
| `code.tsx` | `CodeBlock` (the GIX code window: highlighting, copy, file name, language, line highlight, wrap), `CodeTabs`, `PackageInstall`, `InstallerCommand`, `Terminal` |
| `highlight.ts` | Dependency-free tokenizer for TS/JS/JSX, JSON, shell, YAML, CSS, HTML/Vue and SQL |
| `icons.tsx` | Inline stroke icon set |
| `theme.ts` | Dark / Light / System, applied before first paint |

## Rules

- Components use semantic tokens, never raw hex values (except the always-dark code surfaces).
- GIX red (`#D61920`) is an accent: primary buttons, the active navigation marker, the wordmark
  underline, heading highlights and security emphasis. No large red backgrounds.
- The red glow (`--accent-glow`) is reserved for the CTA, the active architecture node and
  security decisions.
- Headlines use JetBrains Mono (uppercase, tight tracking), body text Inter, code JetBrains Mono
  with ligatures disabled. Both fonts are self-hosted.
- Status colors (`--success`, `--warning`, `--info`) have darker light-theme values so badges
  pass WCAG AA on white.
- Layouts use logical properties (`inline-start`, `block-end`) so they mirror in RTL.

## Logo

The repository has no official GIX logo asset. `GixWordmark` is a text placeholder ("GIX" plus
the product name with a red underline), and `public/favicon.svg` is a matching text mark. Replace
both when the official asset is available; the placeholder is not a new logo.
