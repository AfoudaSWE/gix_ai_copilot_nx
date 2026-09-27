import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Link } from '../router.js';
import { Icon } from './icons.js';
import type { IconName } from './icons.js';

/**
 * GIX brand components shared by the website and the documentation. No official GIX logo
 * asset exists in the repository, so the mark is a text wordmark placeholder (not a
 * replacement logo).
 */
export function GixWordmark({ product = 'AI', compact = false }: { readonly product?: string; readonly compact?: boolean }) {
  return (
    <span className="gix-wordmark" role="img" aria-label={`GIX ${product}`}>
      <span className="gix-wordmark__mark" aria-hidden="true">
        GIX
      </span>
      {!compact && (
        <span className="gix-wordmark__product" aria-hidden="true">
          {product}
        </span>
      )}
    </span>
  );
}

export const GixLogo = GixWordmark;

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export function GixButton({ href, variant = 'primary', size, icon, children, ...rest }: { readonly href: string; readonly variant?: ButtonVariant; readonly size?: 'sm'; readonly icon?: IconName; readonly children: ReactNode; readonly 'aria-label'?: string }) {
  return (
    <Link href={href} className={`gix-button gix-button--${variant}${size ? ` gix-button--${size}` : ''}`} {...rest}>
      {children}
      {icon && <Icon name={icon} size={16} />}
    </Link>
  );
}

export type Status = 'stable' | 'beta' | 'experimental' | 'deprecated';

export function GixBadge({ status, children }: { readonly status?: Status | 'accent'; readonly children?: ReactNode }) {
  return <span className={`gix-badge${status ? ` gix-badge--${status}` : ''}`}>{children ?? status}</span>;
}

/** Stable / Beta / Experimental / Deprecated, as recorded in the repository's maturity table. */
export function FeatureStatus({ status }: { readonly status: Status }) {
  const label = status[0]?.toUpperCase() + status.slice(1);
  return (
    <GixBadge status={status}>
      <span className="visually-hidden">Status: </span>
      {label}
    </GixBadge>
  );
}

export function GixCard({ title, description, icon, href, badge, children }: { readonly title: string; readonly description?: ReactNode; readonly icon?: IconName; readonly href?: string; readonly badge?: ReactNode; readonly children?: ReactNode }) {
  const body = (
    <>
      <div className="gix-card__head">
        {icon && (
          <span className="gix-card__icon">
            <Icon name={icon} />
          </span>
        )}
        {badge}
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {children}
      {href && (
        <span className="gix-card__more" aria-hidden="true">
          <Icon name="arrowRight" size={16} />
        </span>
      )}
    </>
  );
  return href ? (
    <Link href={href} className="gix-card">
      {body}
    </Link>
  ) : (
    <div className="gix-card">{body}</div>
  );
}

export function CardGrid({ children, columns }: { readonly children: ReactNode; readonly columns?: 3 }) {
  return <div className={`gix-card-grid${columns ? ` gix-card-grid--${columns}` : ''}`}>{children}</div>;
}

export function GixSectionHeading({ eyebrow, title, children, center = false, id }: { readonly eyebrow?: string; readonly title: ReactNode; readonly children?: ReactNode; readonly center?: boolean; readonly id?: string }) {
  return (
    <header className={`gix-section-heading${center ? ' gix-section-heading--center' : ''}`}>
      {eyebrow && <span className="gix-eyebrow">{eyebrow}</span>}
      <h2 id={id}>{title}</h2>
      {children && <p>{children}</p>}
    </header>
  );
}

/** The restrained GIX-red emphasis used inside headings. */
export function GixGradientText({ children }: { readonly children: ReactNode }) {
  return <span className="gix-highlight">{children}</span>;
}

/** Accessible tabs (WAI-ARIA tabs pattern: arrow keys, Home/End, roving tabindex). */
export function Tabs({ label, tabs, initial = 0, onChange }: { readonly label: string; readonly tabs: readonly { readonly id: string; readonly label: ReactNode; readonly content: ReactNode }[]; readonly initial?: number; readonly onChange?: (index: number) => void }) {
  const [active, setActive] = useState(initial);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const select = (index: number): void => {
    setActive(index);
    onChange?.(index);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const last = tabs.length - 1;
    const rtl = event.currentTarget.closest('[dir="rtl"]') !== null;
    const map: Record<string, number> = { ArrowRight: rtl ? active - 1 : active + 1, ArrowLeft: rtl ? active + 1 : active - 1, Home: 0, End: last };
    const next = map[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const index = (next + tabs.length) % tabs.length;
    select(index);
    refs.current[index]?.focus();
  };
  return (
    <div className="gix-tabs">
      <div className="gix-tabs__list" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.id}`}
            aria-selected={index === active}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={index === active ? 0 : -1}
            className="gix-tabs__tab"
            onClick={() => select(index)}
            onKeyDown={onKeyDown}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <div key={tab.id} role="tabpanel" id={`${base}-panel-${tab.id}`} aria-labelledby={`${base}-tab-${tab.id}`} hidden={index !== active} className="gix-tabs__panel">
          {tab.content}
        </div>
      ))}
    </div>
  );
}

export type CalloutKind = 'info' | 'tip' | 'warning' | 'security' | 'experimental';
const CALLOUT: Readonly<Record<CalloutKind, { icon: IconName; title: string }>> = {
  info: { icon: 'info', title: 'Note' },
  tip: { icon: 'lightbulb', title: 'Tip' },
  warning: { icon: 'alert', title: 'Warning' },
  security: { icon: 'shield', title: 'Security' },
  experimental: { icon: 'flask', title: 'Experimental' },
};

export function Callout({ kind = 'info', title, children }: { readonly kind?: CalloutKind; readonly title?: string; readonly children: ReactNode }) {
  const meta = CALLOUT[kind];
  return (
    <aside className={`gix-callout gix-callout--${kind}`} aria-label={title ?? meta.title}>
      <span className="gix-callout__icon">
        <Icon name={meta.icon} />
      </span>
      <div className="gix-callout__body">
        <strong className="gix-callout__title">{title ?? meta.title}</strong>
        {children}
      </div>
    </aside>
  );
}

export function Steps({ steps }: { readonly steps: readonly { readonly title: string; readonly content: ReactNode }[] }) {
  return (
    <ol className="gix-steps">
      {steps.map((step, index) => (
        <li key={step.title} className="gix-steps__item">
          <span className="gix-steps__number" aria-hidden="true">
            {String(index + 1).padStart(2, '0')}
          </span>
          <div>
            <h3>{step.title}</h3>
            {step.content}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Disclosure list built on native <details> (keyboard and screen-reader support for free). */
export function Accordion({ items }: { readonly items: readonly { readonly title: ReactNode; readonly content: ReactNode; readonly open?: boolean }[] }) {
  return (
    <div className="gix-accordion">
      {items.map((item, index) => (
        <details key={index} open={item.open}>
          <summary>
            {item.title}
            <Icon name="chevronDown" size={16} className="gix-accordion__chevron" />
          </summary>
          <div className="gix-accordion__body">{item.content}</div>
        </details>
      ))}
    </div>
  );
}

/** A node in an architecture diagram. `state` distinguishes implemented / optional / external. */
export function GixArchitectureNode({ label, detail, icon, state = 'implemented', active = false, onActivate }: { readonly label: string; readonly detail?: string; readonly icon?: IconName; readonly state?: 'implemented' | 'optional' | 'external'; readonly active?: boolean; readonly onActivate?: () => void }) {
  const content = (
    <>
      {icon && <Icon name={icon} size={16} />}
      <span>{label}</span>
      {state !== 'implemented' && <span className="gix-arch-node__state">{state}</span>}
    </>
  );
  const className = `gix-arch-node gix-arch-node--${state}${active ? ' is-active' : ''}`;
  return onActivate ? (
    <button type="button" className={className} aria-pressed={active} onClick={onActivate} onMouseEnter={onActivate} onFocus={onActivate} title={detail}>
      {content}
    </button>
  ) : (
    <div className={className} title={detail}>
      {content}
    </div>
  );
}
