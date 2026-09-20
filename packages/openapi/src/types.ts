import type { DataClassification, ToolActionRisk, ToolActionReversibility, ToolApprovalLevel } from '@gixcopilot/protocol';
import type { JsonSchemaLike } from '@gixcopilot/tools';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'trace';

/**
 * Where an OpenAPI document comes from (Section 9-10). Remote loading is a distinct,
 * explicit variant - never inferred from a plain string that could be model-influenced - so
 * a caller must deliberately opt into fetching a URL (see loader.ts's doc comment on why
 * that boundary matters).
 */
export type OpenAPISource =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'object'; readonly document: unknown }
  | { readonly kind: 'url'; readonly url: string };

/** The parts of an OpenAPI 3.0/3.1 document this package actually reads - deliberately not
 * the full spec type, so a third-party OpenAPI type package is never a public dependency of
 * this SDK (Section 144's dependency-boundary rule). */
export interface OpenAPIDocument {
  readonly openapi: string;
  readonly info?: { readonly title?: string; readonly version?: string };
  readonly servers?: readonly { readonly url: string }[];
  readonly paths?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly components?: { readonly schemas?: Readonly<Record<string, unknown>> };
}

export interface OpenAPIParameterCandidate {
  readonly name: string;
  readonly in: 'path' | 'query' | 'header' | 'cookie';
  readonly required: boolean;
  readonly schema: JsonSchemaLike;
  readonly description?: string;
  readonly style?: string;
  readonly explode?: boolean;
}

/** The intermediate representation every discovered operation becomes before any tool is
 * generated (Section 15) - policies and schema conversion both read this, never the raw
 * document directly, so the pipeline stays Document -> Candidates -> Policies -> Tools. */
export interface OpenAPIOperationCandidate {
  readonly method: HttpMethod;
  readonly path: string;
  readonly operationId?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly parameters: readonly OpenAPIParameterCandidate[];
  readonly requestBodySchema?: JsonSchemaLike;
  readonly requestBodyRequired?: boolean;
  readonly tags?: readonly string[];
  readonly responseSchemas?: Readonly<Record<string, JsonSchemaLike>>;
  readonly issues?: readonly string[];
}

/** Preserved on every generated tool (Section 50-51, 96) via `ToolMetadata.custom` - never a
 * new top-level `ToolMetadata` field, so the canonical tool shape does not grow per source
 * (see Phase 5's own `custom` doc comment, written for exactly this moment). */
export interface OpenAPIToolSourceMetadata {
  readonly sourceType: 'openapi';
  readonly integrationId: string;
  readonly operationId?: string;
  readonly method: HttpMethod;
  readonly path: string;
  /** The source document's declared `openapi` version string (e.g. `"3.1.0"`) - a lightweight
   * stand-in for "which document" (Section 50) without embedding the full parsed document into
   * every generated tool's metadata; combined with `operationId`/`method`/`path`, this is
   * enough for Section 63's "detect operation removed/schema changed" on a refresh. */
  readonly specVersion?: string;
  readonly documentVersion?: string;
}

export type OperationExposure = 'allow' | 'approval' | 'deny';

export interface OpenAPIMethodPolicy {
  readonly get?: OperationExposure;
  readonly post?: OperationExposure;
  readonly put?: OperationExposure;
  readonly patch?: OperationExposure;
  readonly delete?: OperationExposure;
  readonly head?: OperationExposure;
  readonly options?: OperationExposure;
  readonly trace?: OperationExposure;
}

/** Per-operation override (Section 42-43) - identified by `operationId` when present, else
 * `"METHOD /path"` (e.g. `"POST /applications/{id}/assign"`), exactly as discovered. */
export interface OpenAPIOperationOverride {
  readonly expose?: boolean;
  readonly permission?: string;
  readonly requiredPermissions?: readonly string[];
  readonly risk?: ToolActionRisk;
  readonly reversibility?: ToolActionReversibility;
  readonly approval?: ToolApprovalLevel;
  readonly dataClassification?: DataClassification;
  readonly name?: string;
  readonly description?: string;
  /** Header parameter names explicitly allowlisted as model-controlled tool input (Section
   * 24) - every other header parameter is excluded from the generated tool, never exposed by
   * default. */
  readonly allowedHeaderParameters?: readonly string[];
}

export interface RegistrationWarning {
  readonly operation: string;
  readonly message: string;
}

export interface DocumentIssue {
  readonly path: string;
  readonly problem: string;
}

export interface RegistrationConflict {
  readonly name: string;
  readonly operations: readonly string[];
}

/** Returned by both `inspectOpenAPI` (preview) and `registerOpenAPI` (real registration) -
 * Section 60's registration report, Section 104's generation-result numbers, and Section
 * 106-107's inspect-before-register separation all read from this same shape. */
export interface OpenAPIGenerationReport {
  readonly integrationId: string;
  /** A document-level failure (invalid document, unresolvable `$ref`, no usable base URL) -
   * when non-empty, every other count is `0` and no tools were generated at all, since no
   * per-operation processing could begin. */
  readonly documentIssues: readonly DocumentIssue[];
  readonly operationsDiscovered: number;
  readonly generated: number;
  /** Not generated due to a within-document tool-name conflict (Section 18) - never silently
   * overwritten; see `conflicts` for which operations collided. */
  readonly skipped: number;
  readonly denied: number;
  /** Exposed by policy, but the operation's parameters/request body could not be converted to
   * a safe Zod schema (Section 28) - see `warnings` for the diagnostic. */
  readonly unsupported: number;
  readonly warnings: readonly RegistrationWarning[];
  readonly conflicts: readonly RegistrationConflict[];
}
