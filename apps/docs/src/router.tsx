import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

/**
 * A tiny History API router: readable URLs (/docs/tools), real <a href> links that work
 * without JavaScript (every route is prerendered), and client-side navigation after hydration.
 */
export interface Location {
  readonly pathname: string;
  readonly hash: string;
}

interface RouterValue {
  readonly location: Location;
  readonly navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

/** Normalizes a path: no trailing slash (except "/"), no index.html. */
export function normalizePath(pathname: string): string {
  const clean = pathname.replace(/\/index\.html$/, '/').replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
}

function readLocation(): Location {
  return { pathname: normalizePath(globalThis.location?.pathname ?? '/'), hash: globalThis.location?.hash ?? '' };
}

export function RouterProvider({ initialPath, preload, children }: { readonly initialPath?: string; /** Loads a route's code and data before it is shown. */ readonly preload?: (pathname: string) => Promise<void>; readonly children: ReactNode }) {
  const [location, setLocation] = useState<Location>(() => {
    if (initialPath !== undefined) {
      const [pathname = '/', hash = ''] = initialPath.split('#');
      return { pathname: normalizePath(pathname), hash: hash ? `#${hash}` : '' };
    }
    return readLocation();
  });

  useEffect(() => {
    const onPop = (): void => {
      const next = readLocation();
      void Promise.resolve(preload?.(next.pathname))
        .catch(() => undefined)
        .then(() => setLocation(next));
    };
    globalThis.addEventListener('popstate', onPop);
    return () => globalThis.removeEventListener('popstate', onPop);
  }, [preload]);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const url = new URL(to, globalThis.location.href);
    if (url.origin !== globalThis.location.origin) {
      globalThis.location.assign(url.href);
      return;
    }
    const next = { pathname: normalizePath(url.pathname), hash: url.hash };
    const samePage = next.pathname === normalizePath(globalThis.location.pathname);
    void Promise.resolve(samePage ? undefined : preload?.(next.pathname))
      .catch(() => undefined)
      .then(() => {
        globalThis.history[options?.replace ? 'replaceState' : 'pushState'](null, '', `${next.pathname}${url.search}${url.hash}`);
        setLocation(next);
        if (url.hash) {
          // After render, bring the target heading into view.
          requestAnimationFrame(() => document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView());
        } else if (!samePage) {
          globalThis.scrollTo({ top: 0 });
        }
      });
  }, [preload]);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('useRouter must be used inside <RouterProvider>.');
  return value;
}

export function isInternal(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { readonly href: string };

/** An <a> that navigates client-side for internal links and opens external links normally. */
export function Link({ href, onClick, children, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  const internal = isInternal(href);
  return (
    <a
      href={href}
      {...(!internal && /^https?:/.test(href) ? { target: '_blank', rel: 'noreferrer' } : {})}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        if (!internal || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

/** Scrolls to the URL's #fragment once the (possibly lazily loaded) content is rendered. */
export function useScrollToHash(ready: boolean): void {
  const { location } = useRouter();
  useEffect(() => {
    if (!ready || !location.hash) return;
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  }, [ready, location.hash, location.pathname]);
}
