import type { ContextPriority } from './context-priority.js';
import type { ContextScope } from './context-scope.js';
import type { ContextSensitivity } from './context-sensitivity.js';

/**
 * Why an otherwise-registered item did not make it into the resolved context (Section 35).
 * Phase 4 does not implement every policy type this closed set anticipates (e.g. a real
 * `sensitivity-policy` engine is Phase 7's), but the shape is stable so later phases add
 * reasons additively rather than repurposing an existing one.
 */
export type ContextExclusionReason =
  | 'disabled'
  | 'budget'
  | 'duplicate'
  | 'invalid'
  | 'sensitivity-policy'
  | 'serialization-failure';

export interface ContextExclusion {
  readonly id: string;
  readonly name: string;
  readonly scope: ContextScope;
  readonly reason: ContextExclusionReason;
  readonly detail?: string;
}

/** One included item, formatted and budgeted (Section 22, 34). */
export interface ResolvedContextItem {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly scope: ContextScope;
  readonly priority: ContextPriority;
  readonly sensitivity: ContextSensitivity;
  readonly estimatedTokens: number;
  readonly truncated: boolean;
  /** The formatted `[Context: name] ...` block for this item alone (Section 22). */
  readonly text: string;
}

/** Lightweight observability counters for one resolution pass (Section 62). */
export interface ContextDiagnostics {
  readonly itemsRegistered: number;
  readonly itemsIncluded: number;
  readonly itemsExcluded: number;
  readonly resolutionMs: number;
}

/** The output of `ContextEngine.resolve()` - everything needed to build a model request. */
export interface ResolvedContext {
  readonly items: readonly ResolvedContextItem[];
  /** All included items' `text`, joined - ready to place into a model request (Section 33). */
  readonly content: string;
  readonly estimatedTokens: number;
  readonly excluded: readonly ContextExclusion[];
  readonly diagnostics: ContextDiagnostics;
}

/** The debug-friendly projection `ContextEngine.inspect()` returns (Section 57, 90). */
export interface ContextInspection {
  readonly estimatedTokens: number;
  readonly included: readonly {
    readonly name: string;
    readonly scope: ContextScope;
    readonly priority: ContextPriority;
    readonly estimatedTokens: number;
    readonly truncated: boolean;
  }[];
  readonly excluded: readonly {
    readonly name: string;
    readonly scope: ContextScope;
    readonly reason: ContextExclusionReason;
  }[];
  readonly diagnostics: ContextDiagnostics;
}
