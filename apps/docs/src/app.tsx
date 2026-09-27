import { Component, useEffect, useReducer, useRef } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { SearchProvider } from './docs/search.js';
import { loadPage, pageComponent } from './page-registry.js';
import { RouterProvider, useRouter } from './router.js';
import { metaFor, resolveRoute } from './routes.js';

/** A failing interactive demo or page must never take the whole site down. */
export class ErrorBoundary extends Component<{ readonly children: ReactNode; readonly resetKey: string }, { readonly failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidUpdate(previous: { readonly resetKey: string }): void {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('GIX site render error', error, info.componentStack);
  }
  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="render-error" role="alert">
          <h1>Something went wrong on this page.</h1>
          <p>
            Try reloading, or go to the <a href="/docs">documentation home</a>.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

function Page() {
  const { location } = useRouter();
  const route = resolveRoute(location.pathname);
  const first = useRef(true);
  const [, rerender] = useReducer((value: number) => value + 1, 0);

  // On client navigation: update the title and move focus to the new page's heading.
  useEffect(() => {
    document.title = metaFor(location.pathname).title;
    if (first.current) {
      first.current = false;
      return;
    }
    if (!location.hash) document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
  }, [location.pathname, location.hash]);

  // Normally already loaded (before hydration / navigation); load now as a fallback.
  const missing = pageComponent(route.kind) === undefined;
  useEffect(() => {
    if (missing) void loadPage(location.pathname).then(rerender, rerender);
  }, [missing, location.pathname]);

  if (route.kind === 'doc') {
    const Doc = pageComponent('doc');
    return Doc ? <Doc key={route.slug} slug={route.slug} source={route.source} /> : <PageLoading />;
  }
  if (route.kind === 'api-package') {
    const Api = pageComponent('api-package');
    return Api ? <Api key={route.slug} slug={route.slug} /> : <PageLoading />;
  }
  const Simple = pageComponent(route.kind);
  return Simple ? <Simple /> : <PageLoading />;
}

function PageLoading() {
  return <div className="page-loading" role="progressbar" aria-label="Loading page" />;
}

function Shell() {
  const { location } = useRouter();
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <ErrorBoundary resetKey={location.pathname}>
        <Page />
      </ErrorBoundary>
    </>
  );
}

export function App({ initialPath }: { readonly initialPath?: string }) {
  return (
    <RouterProvider initialPath={initialPath} preload={loadPage}>
      <SearchProvider>
        <Shell />
      </SearchProvider>
    </RouterProvider>
  );
}
