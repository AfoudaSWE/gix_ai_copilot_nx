import type { ToolActionRisk, ToolActionReversibility, ToolApprovalLevel, DataClassification } from '@gixcopilot/protocol';

/**
 * Trusted, server-derived metadata about the action being evaluated (Section 10, 19) - built
 * from the *registered* tool's own declared `security` manifest, never merged from model
 * output or client-supplied fields. A model requesting `{"role":"ADMIN"}` as a tool argument
 * must never influence this shape (Section 98's required test).
 */
export interface ActionMetadata {
  readonly toolName: string;
  readonly source: 'frontend' | 'backend';
  readonly risk?: ToolActionRisk;
  readonly reversibility?: ToolActionReversibility;
  readonly requiredPermissions?: readonly string[];
  readonly approval?: ToolApprovalLevel;
  readonly dataClassification?: DataClassification;
}

/**
 * One action the AI (or, for a directly-invoked frontend tool, the UI) is requesting (Section
 * 10). `arguments` is the model-provided, UNTRUSTED payload; `metadata` is TRUSTED, assembled
 * server-side - keeping these separate is the whole point of this type (Section 10's "do not
 * blindly trust metadata supplied by the model").
 */
export interface ActionRequest {
  /** Trusted runtime flag: reauthorization does not consume a second rate-limit unit. */
  readonly revalidation?: boolean;
  readonly actionId: string;
  readonly runId: string;
  readonly toolCallId?: string;
  readonly action: string;
  readonly arguments: unknown;
  readonly metadata: ActionMetadata;
}
