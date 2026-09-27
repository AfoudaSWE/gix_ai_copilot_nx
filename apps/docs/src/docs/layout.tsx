import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { GixWordmark } from '../design/components.js';
import { Icon } from '../design/icons.js';
import { Link, useRouter } from '../router.js';
import { SITE } from '../site.js';
import { ThemeToggle } from '../shell/theme-toggle.js';
import type { Heading } from './markdown-utils.js';
import { DOC_SECTIONS, docPath } from './nav.js';
import { SearchButton } from './search.js';

const TOP_LINKS = [
  { href: '/docs', label: 'Documentation' },
  { href: '/docs/api', label: 'API Reference' },
  { href: '/examples', label: 'Examples' },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/docs') return pathname === '/docs' || (pathname.startsWith('/docs/') && !pathname.startsWith('/docs/api'));
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DocsHeader({ onMenu }: { readonly onMenu: () => void }) {
  const { location } = useRouter();
  return (
    <header className="docs-header">
      <div className="docs-header__inner">
        <button type="button" className="gix-icon-button docs-header__menu" aria-label="Open documentation menu" onClick={onMenu}>
          <Icon name="menu" />
        </button>
        <Link href="/" className="docs-header__brand" aria-label="GIX AI home">
          <GixWordmark />
          <span className="docs-header__docs">Docs</span>
        </Link>
        <nav aria-label="Primary" className="docs-header__nav">
          {TOP_LINKS.map((link) => (
            <Link key={link.href} href={link.href} aria-current={isActive(location.pathname, link.href) ? 'page' : undefined}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="docs-header__search">
          <SearchButton />
        </div>
        <div className="docs-header__actions">
          <span className="docs-header__search-compact">
            <SearchButton compact />
          </span>
          <a className="gix-icon-button" href={SITE.github} target="_blank" rel="noreferrer" aria-label="GitHub repository (opens in a new tab)">
            <Icon name="github" />
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function DocsSidebar({ onNavigate }: { readonly onNavigate?: () => void }) {
  const { location } = useRouter();
  return (
    <nav aria-label="Documentation" className="docs-sidebar__nav">
      {DOC_SECTIONS.map((section) => (
        <section key={section.title} className="docs-sidebar__section">
          <h2>
            <Icon name={section.icon} size={14} />
            {section.title}
          </h2>
          <ul>
            {section.pages.map((page) => {
              const href = docPath(page.slug);
              const current = location.pathname === href || (page.slug === 'api' && location.pathname.startsWith('/docs/api/'));
              return (
                <li key={page.slug}>
                  <Link href={href} aria-current={current ? 'page' : undefined} onClick={() => onNavigate?.()}>
                    {page.label}
                    {page.status === 'experimental' && <span className="docs-sidebar__dot" title="Experimental" aria-label="(experimental)" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/** The mobile drawer: a modal dialog that traps focus and closes on Esc or navigation. */
function Drawer({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    panel.current?.querySelector<HTMLElement>('button, a')?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('a[href], button')];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="docs-drawer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="docs-drawer__panel" role="dialog" aria-modal="true" aria-label="Documentation menu" ref={panel}>
        <div className="docs-drawer__head">
          <GixWordmark />
          <button type="button" className="gix-icon-button" aria-label="Close menu" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <nav aria-label="Sections" className="docs-drawer__top">
          {TOP_LINKS.map((link) => (
            <Link key={link.href} href={link.href} onClick={onClose}>
              {link.label}
            </Link>
          ))}
        </nav>
        <DocsSidebar onNavigate={onClose} />
      </div>
    </div>
  );
}

/** "On this page": desktop right rail with scroll spy; a disclosure above the article on mobile. */
export function TableOfContents({ headings, variant = 'rail' }: { readonly headings: readonly Heading[]; readonly variant?: 'rail' | 'inline' }) {
  const [active, setActive] = useState<string | undefined>(headings[0]?.id);
  useEffect(() => {
    if (variant !== 'rail' || headings.length === 0 || typeof IntersectionObserver === 'undefined') return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
        const first = headings.find((heading) => visible.get(heading.id));
        if (first) setActive(first.id);
      },
      { rootMargin: '-72px 0px -65% 0px' },
    );
    for (const heading of headings) {
      const element = document.getElementById(heading.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [headings, variant]);
  if (headings.length === 0) return null;
  const list = (
    <ul>
      {headings.map((heading) => (
        <li key={heading.id} className={heading.depth === 3 ? 'toc__sub' : undefined}>
          <a href={`#${heading.id}`} aria-current={heading.id === active ? 'location' : undefined}>
            {heading.text}
          </a>
        </li>
      ))}
    </ul>
  );
  return variant === 'rail' ? (
    <nav aria-label="On this page" className="toc toc--rail">
      <p className="toc__title">On this page</p>
      {list}
    </nav>
  ) : (
    <details className="toc toc--inline">
      <summary>On this page</summary>
      {list}
    </details>
  );
}

export function DocsLayout({ children, toc }: { readonly children: ReactNode; readonly toc?: ReactNode }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="docs-shell">
      <DocsHeader onMenu={() => setMenu(true)} />
      <Drawer open={menu} onClose={() => setMenu(false)} />
      <div className="docs-body">
        <aside className="docs-sidebar" aria-label="Documentation navigation">
          <DocsSidebar />
        </aside>
        <main id="main" className="docs-main" tabIndex={-1}>
          {children}
        </main>
        <aside className="docs-toc">{toc}</aside>
      </div>
    </div>
  );
}
