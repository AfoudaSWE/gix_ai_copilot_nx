import { Icon } from '../design/icons.js';
import { useTheme } from '../design/theme.js';

const LABEL = { dark: 'Dark', light: 'Light', system: 'System' } as const;
const ICON = { dark: 'moon', light: 'sun', system: 'monitor' } as const;
const NEXT = { dark: 'light', light: 'system', system: 'dark' } as const;

/** Cycles Dark → Light → System; the label announces the current and next theme. */
export function ThemeToggle() {
  const { choice, cycle } = useTheme();
  return (
    <button type="button" className="gix-icon-button" onClick={cycle} aria-label={`Theme: ${LABEL[choice]}. Switch to ${LABEL[NEXT[choice]]}`} title={`Theme: ${LABEL[choice]}`}>
      <Icon name={ICON[choice]} />
    </button>
  );
}
