/**
 * The provider-neutral shared-state patch contract (Section 41-42 of the Phase 6 brief).
 * Deliberately smaller than the brief's own illustrative RFC 6902-flavored sample
 * (`{ op: 'replace', path: '/status', value: ... }`): a state slot already holds one typed
 * value, so "replace one field" only ever needs two operations - `'set'` (replace the whole
 * value) and `'merge'` (shallow-merge a partial object into the current value) - not a
 * general JSON-Pointer path language, which Section 42 explicitly warns against
 * ("avoid an excessively powerful expression language"). See
 * `docs/adr/0011-generative-ui-and-state-patch-architecture.md`.
 */
export type StatePatchOp = 'set' | 'merge';

export interface StatePatch {
  readonly op: StatePatchOp;
  readonly value: unknown;
}

export type StatePatchRejectionReason =
  | 'unknown-state'
  | 'not-writable'
  | 'invalid-value'
  | 'invalid-patch';

/**
 * The outcome of `CopilotStateStore.applyPatch()` (Section 43, 45-46). A discriminated
 * union so a caller (typically the reserved state-patch tool a writable state slot
 * auto-registers - see `@gixcopilot/generative-ui`) can distinguish "stale revision, safe to
 * retry with the current value" from "rejected outright" without parsing a message string.
 */
export type StatePatchResult =
  | { readonly status: 'applied'; readonly revision: number; readonly value: unknown }
  | { readonly status: 'conflict'; readonly currentRevision: number }
  | { readonly status: 'rejected'; readonly reason: StatePatchRejectionReason; readonly detail?: string };
