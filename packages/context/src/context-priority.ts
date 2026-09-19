/**
 * Explicit context priority (Section 20). A closed set of four tiers, not a numeric scale -
 * numeric priority invites meaningless fine-grained comparisons ("47 vs 48") with no
 * documented semantics. Priority affects budget selection only; it is never a security
 * boundary (see Section 20 and the security skill).
 */
export type ContextPriority = 'critical' | 'high' | 'normal' | 'low';

export const CONTEXT_PRIORITIES: readonly ContextPriority[] = ['critical', 'high', 'normal', 'low'];

export const DEFAULT_CONTEXT_PRIORITY: ContextPriority = 'normal';

const PRIORITY_WEIGHT: Readonly<Record<ContextPriority, number>> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Lower is more important. Used to sort items before budget allocation (Section 27). */
export function priorityWeight(priority: ContextPriority): number {
  return PRIORITY_WEIGHT[priority];
}

export function isContextPriority(value: unknown): value is ContextPriority {
  return typeof value === 'string' && (CONTEXT_PRIORITIES as readonly string[]).includes(value);
}
