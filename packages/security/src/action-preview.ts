import type { ToolActionPreview, ToolActionRisk, ToolActionReversibility, ToolChangePreview } from '@gixcopilot/protocol';

/**
 * The result of a dry run (Section 48-51) - a preview of what an action *would* do, produced
 * without performing the real mutation. Sensitive fields must already be filtered before this
 * reaches an approval UI (Section 51) - this type carries no classification metadata of its
 * own; that is the data policy's job (see pii.ts), applied before a preview is ever rendered.
 * Aliased from `@gixcopilot/protocol` (not redefined here) since it must cross the wire
 * unchanged as part of `approval.requested` - one shape, one source of truth.
 */
export type ChangePreview = ToolChangePreview;
export type ActionPreview = ToolActionPreview;

/** A human-facing explanation of a requested action (Section 46-47) - "for humans," never a
 * substitute for the firewall's own authorization decision. `risk` here is the tool's
 * declared classification (Section 47's "prefer deterministic data ... not invent authoritative
 * business effects"), not model-generated text. */
export interface ActionExplanation {
  readonly action: string;
  readonly summary: string;
  readonly changes?: readonly ChangePreview[];
  readonly impact?: string;
  readonly risk?: { readonly risk?: ToolActionRisk; readonly reversibility?: ToolActionReversibility };
}
