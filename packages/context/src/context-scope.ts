/**
 * The lifetime/origin classification of a context item. Each scope carries its own
 * semantics (Sections 8-15) rather than being an implicit convention:
 *
 *  - `global`      - company/product-wide terminology or instructions. Rare; not a dumping
 *                    ground for everything an application knows.
 *  - `user`        - the current authenticated user (id, locale, role names, preferences).
 *                    Treat as untrusted-for-authorization, not just untrusted-for-injection.
 *  - `application` - the hosting application/module/workspace/business domain.
 *  - `page`        - the current route, page type, current entity, visible filters/dataset.
 *  - `component`   - focused information a single mounted component chooses to expose.
 *  - `session`     - short-lived workflow state (current wizard step, current search) - not
 *                    durable AI memory (that is a later phase's concern).
 *  - `temporary`   - very short-lived transient state (open modal, hovered/selected object).
 */
export type ContextScope =
  | 'global'
  | 'user'
  | 'application'
  | 'page'
  | 'component'
  | 'session'
  | 'temporary';

export const CONTEXT_SCOPES: readonly ContextScope[] = [
  'global',
  'user',
  'application',
  'page',
  'component',
  'session',
  'temporary',
];

export function isContextScope(value: unknown): value is ContextScope {
  return typeof value === 'string' && (CONTEXT_SCOPES as readonly string[]).includes(value);
}
