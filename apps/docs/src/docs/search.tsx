import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../design/icons.js';
import { useRouter } from '../router.js';
import { searchIndex } from './search-core.js';
import type { SearchEntry } from './search-core.js';

interface SearchValue {
  readonly open: (initialQuery?: string) => void;
}

const SearchContext = createContext<SearchValue>({ open: () => undefined });

export function useSearch(): SearchValue {
  return useContext(SearchContext);
}

let indexPromise: Promise<readonly SearchEntry[]> | undefined;
/** The index is a separate chunk generated at build time; it loads on first use only. */
export function loadSearchIndex(): Promise<readonly SearchEntry[]> {
  indexPromise ??= import('virtual:gix-search-index').then((module) => module.default as readonly SearchEntry[]);
  return indexPromise;
}

const SUGGESTIONS = ['Quickstart', 'useCopilotContext', 'defineTool', 'Action Firewall', 'createCopilot', 'RAG'];

export function SearchProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; query: string }>({ open: false, query: '' });
  const open = useCallback((initialQuery = '') => setState({ open: true, query: initialQuery }), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setState((current) => ({ open: !current.open, query: '' }));
      } else if (event.key === '/' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        setState({ open: true, query: '' });
      }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <SearchContext.Provider value={value}>
      {children}
      {state.open && <SearchDialog initialQuery={state.query} onClose={() => setState({ open: false, query: '' })} />}
    </SearchContext.Provider>
  );
}

const KIND_ICON = { page: 'file', section: 'hash', api: 'code', cli: 'terminal', site: 'globe' } as const;

export function SearchDialog({ initialQuery, onClose }: { readonly initialQuery: string; readonly onClose: () => void }) {
  const { navigate } = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [entries, setEntries] = useState<readonly SearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restore = useRef<Element | null>(null);
  const base = useId();

  useEffect(() => {
    restore.current = document.activeElement;
    inputRef.current?.focus();
    loadSearchIndex().then(setEntries, () => setFailed(true));
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
      if (restore.current instanceof HTMLElement) restore.current.focus();
    };
  }, []);

  const groups = useMemo(() => (entries ? searchIndex(entries, query) : []), [entries, query]);
  const flat = useMemo(() => groups.flatMap((group) => group.results), [groups]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (entry: SearchEntry | undefined): void => {
    if (!entry) return;
    onClose();
    navigate(entry.url);
  };
  const optionId = (index: number): string => `${base}-option-${index}`;
  let counter = -1;

  return (
    <div className="search-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search documentation"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          } else if (event.key === 'Tab') {
            // Keep focus inside the dialog (the input is the only interactive stop).
            event.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        <div className="search-dialog__field">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={`${base}-listbox`}
            aria-activedescendant={flat.length > 0 ? optionId(active) : undefined}
            aria-autocomplete="list"
            aria-label="Search GIX AI docs"
            placeholder="Search docs, APIs, CLI…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, Math.max(flat.length - 1, 0)));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                go(flat[active]);
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="search-dialog__results" ref={listRef} id={`${base}-listbox`} role="listbox" aria-label="Search results">
          {failed && <p className="search-dialog__empty">Search is unavailable right now.</p>}
          {!failed && !entries && query && <p className="search-dialog__empty">Loading the search index…</p>}
          {!query && (
            <div className="search-dialog__hint">
              <p>Try</p>
              <div className="search-dialog__suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" className="gix-badge" onClick={() => setQuery(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
          {entries && query && flat.length === 0 && (
            <div className="search-dialog__empty">
              <p>
                No results for <strong>“{query}”</strong>.
              </p>
              <p>Check the spelling, or try a broader word such as “tools” or “security”.</p>
            </div>
          )}
          {groups.map((group) => (
            <div key={group.group} role="group" aria-labelledby={`${base}-${group.group}`}>
              <p className="search-dialog__group" id={`${base}-${group.group}`} role="presentation">
                {group.group}
              </p>
              {group.results.map((entry) => {
                counter += 1;
                const index = counter;
                return (
                  <div key={`${entry.url}-${entry.title}`} id={optionId(index)} role="option" aria-selected={index === active} className="search-dialog__option" onMouseMove={() => setActive(index)} onClick={() => go(entry)}>
                    <Icon name={KIND_ICON[entry.kind]} size={16} />
                    <span className="search-dialog__text">
                      <span className="search-dialog__title">
                        {entry.title}
                        {entry.context && <span className="search-dialog__context"> · {entry.context}</span>}
                      </span>
                      {entry.text && <span className="search-dialog__snippet">{entry.text}</span>}
                    </span>
                    <Icon name="chevronRight" size={14} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="search-dialog__footer" aria-hidden="true">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

/** The search trigger used in headers ("Search documentation…  Ctrl K"). */
export function SearchButton({ compact = false }: { readonly compact?: boolean }) {
  const { open } = useSearch();
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '')), []);
  return compact ? (
    <button type="button" className="gix-icon-button" aria-label="Search documentation" onClick={() => open()}>
      <Icon name="search" />
    </button>
  ) : (
    <button type="button" className="search-trigger" onClick={() => open()} aria-label="Search documentation" aria-keyshortcuts="Control+K Meta+K">
      <Icon name="search" size={16} />
      <span>Search documentation…</span>
      <kbd>{mac ? '⌘' : 'Ctrl'} K</kbd>
    </button>
  );
}
