import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { GixButton, GixWordmark } from '../design/components.js';
import { Icon } from '../design/icons.js';
import { SearchButton } from '../docs/search.js';
import { Link, useRouter } from '../router.js';
import { SITE } from '../site.js';
import { ThemeToggle } from '../shell/theme-toggle.js';
import { FOOTER, MENUS } from './menu.js';
import type { Menu } from './menu.js';

/**
 * Disclosure-style dropdown (WAI-ARIA "disclosure navigation"): a button toggles a panel of
 * links; Esc closes and returns focus; arrow keys move between links; outside click closes.
 */
function Dropdown({ menu, open, onOpen, onClose }: { readonly menu: Menu; readonly open: boolean; readonly onOpen: () => void; readonly onClose: () => void }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const links = (): HTMLAnchorElement[] => [...(panel.current?.querySelectorAll('a') ?? [])];
  const onPanelKey = (event: ReactKeyboardEvent): void => {
    const items = links();
    const index = items.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      button.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
      items[(next + items.length) % items.length]?.focus();
    }
  };
  return (
    <div className="site-dropdown" onMouseLeave={() => open && onClose()}>
      <button
        ref={button}
        type="button"
        className="site-nav__trigger"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => (open ? onClose() : onOpen())}
        onMouseEnter={onOpen}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            onOpen();
            requestAnimationFrame(() => links()[0]?.focus());
          } else if (event.key === 'Escape') onClose();
        }}
      >
        {menu.label}
        <Icon name="chevronDown" size={14} />
      </button>
      <div id={id} ref={panel} className="site-dropdown__panel" hidden={!open} onKeyDown={onPanelKey}>
        <ul className={menu.items.length > 6 ? 'site-dropdown__grid' : undefined}>
          {menu.items.map((item) => (
            <li key={item.label}>
              <Link href={item.href} className="site-dropdown__item" onClick={onClose}>
                <span className="gix-card__icon">
                  <Icon name={item.icon} size={16} />
                </span>
                <span>
                  <span className="site-dropdown__label">{item.label}</span>
                  <span className="site-dropdown__desc">{item.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MobileMenu({ onClose }: { readonly onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);
  return (
    <div className="site-mobile" role="dialog" aria-modal="true" aria-label="Menu" ref={panel}>
      <div className="site-mobile__head">
        <GixWordmark />
        <button type="button" className="gix-icon-button" aria-label="Close menu" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <nav aria-label="Mobile">
        {MENUS.map((menu) => (
          <details key={menu.label} className="site-mobile__group">
            <summary>
              {menu.label}
              <Icon name="chevronDown" size={16} />
            </summary>
            <ul>
              {menu.items.map((item) => (
                <li key={item.label}>
                  <Link href={item.href} onClick={onClose}>
                    <Icon name={item.icon} size={16} />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ))}
        <Link href="/docs" className="site-mobile__link" onClick={onClose}>
          Docs
        </Link>
      </nav>
      <div className="site-mobile__cta">
        <GixButton href="/docs/quickstart">Get Started</GixButton>
      </div>
    </div>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { location } = useRouter();
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    setOpen(null);
    setMobile(false);
  }, [location.pathname]);
  useEffect(() => {
    const onScroll = (): void => setScrolled(globalThis.scrollY > 8);
    onScroll();
    globalThis.addEventListener('scroll', onScroll, { passive: true });
    const onDown = (event: MouseEvent): void => {
      if (nav.current && !nav.current.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      globalThis.removeEventListener('scroll', onScroll);
      document.removeEventListener('mousedown', onDown);
    };
  }, []);
  return (
    <header className={`site-header${scrolled ? ' is-scrolled' : ''}`}>
      <div className="site-header__inner container">
        <Link href="/" className="site-header__brand" aria-label="GIX AI home">
          <GixWordmark />
        </Link>
        <nav aria-label="Primary" className="site-nav" ref={nav}>
          {MENUS.map((menu) => (
            <Dropdown key={menu.label} menu={menu} open={open === menu.label} onOpen={() => setOpen(menu.label)} onClose={() => setOpen(null)} />
          ))}
          <Link href="/docs" className="site-nav__link" aria-current={location.pathname.startsWith('/docs') ? 'page' : undefined}>
            Docs
          </Link>
        </nav>
        <div className="site-header__actions">
          <SearchButton compact />
          <a className="gix-icon-button" href={SITE.github} target="_blank" rel="noreferrer" aria-label="GitHub repository (opens in a new tab)">
            <Icon name="github" />
          </a>
          <ThemeToggle />
          <GixButton href="/docs/quickstart" size="sm">
            Get Started
          </GixButton>
          <button type="button" className="gix-icon-button site-header__menu" aria-label="Open menu" aria-expanded={mobile} onClick={() => setMobile(true)}>
            <Icon name="menu" />
          </button>
        </div>
      </div>
      {mobile && <MobileMenu onClose={() => setMobile(false)} />}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div className="site-footer__brand">
          <GixWordmark />
          <p>Enterprise SDK for application-aware AI copilots and agents. MIT licensed.</p>
          <p className="site-footer__version">
            <code>@gixcopilot/*</code> v{SITE.version}
          </p>
        </div>
        {FOOTER.map((column) => (
          <nav key={column.title} aria-label={column.title} className="site-footer__col">
            <h2>{column.title}</h2>
            <ul>
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="container site-footer__legal">
        <span>
          © {new Date().getFullYear()} {SITE.company.name}
        </span>
        <span>No tracking. No cookies.</span>
      </div>
    </footer>
  );
}

/** A branded shell for website pages. */
export function SiteLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="site">
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

