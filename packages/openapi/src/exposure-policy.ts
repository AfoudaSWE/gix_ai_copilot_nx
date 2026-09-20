import { operationKey } from './naming.js';
import type {
  OpenAPIMethodPolicy,
  OpenAPIOperationCandidate,
  OpenAPIOperationOverride,
  OperationExposure,
} from './types.js';

/**
 * Conservative built-in method defaults (Section 47-48), used for any method the caller's own
 * `policies` map does not specify. `GET` defaults to a read candidate (`allow`); `POST`/`PUT`/
 * `PATCH` default to `approval` since a write's real-world effect cannot be inferred from the
 * HTTP method alone (Section 41 cuts both ways - `POST /search` may be read-like, but an
 * unrecognized write-shaped method defaults to requiring approval, never silent execution);
 * `DELETE` defaults to `deny` and must be explicitly enabled (Section 48); `HEAD`/`OPTIONS`/
 * `TRACE` default to `deny` too - Section 49's "NOT EXPOSED rather than permissive exposure"
 * for methods this SDK has no documented safe default for.
 */
const BUILTIN_METHOD_DEFAULTS: Required<OpenAPIMethodPolicy> = {
  get: 'allow',
  post: 'approval',
  put: 'approval',
  patch: 'approval',
  delete: 'deny',
  head: 'deny',
  options: 'deny',
  trace: 'deny',
};

export interface ExposurePolicyOptions {
  readonly policies?: OpenAPIMethodPolicy;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly operations?: Readonly<Record<string, OpenAPIOperationOverride>>;
}

export interface ExposureDecision {
  readonly exposure: OperationExposure;
  readonly reason: string;
  readonly override?: OpenAPIOperationOverride;
}

/**
 * Resolves the allow/approval/deny exposure for one operation (Section 40-49). Precedence,
 * deny-wins throughout (Section 45's "prefer explicit deny winning"):
 *
 * 1. An explicit `exclude` entry always denies, even if the same key is also in `include`.
 * 2. When `include` is provided, any key absent from it is denied (an allowlist is a closed
 *    set - Section 44's "for enterprise usage, allowlists should be easy" implies nothing
 *    outside the list is reachable).
 * 3. `operations[key].expose === false` denies, regardless of method policy.
 * 4. An operation override that expresses explicit intent (`expose: true`, or an explicit
 *    `approval`/`permission`/`risk`) opts the operation in even when its method defaults to
 *    `deny` (e.g. `DELETE`) - but conservatively: opting in a deny-by-default method never
 *    jumps straight to `allow`, only to `approval` (Section 48), unless the override also sets
 *    `approval: "none"` (an unambiguous, explicit statement that no approval is required).
 * 5. Otherwise, the method policy applies: the caller's own `policies` map, falling back to
 *    `BUILTIN_METHOD_DEFAULTS`.
 *
 * This function decides only the coarse allow/approval/deny bucket (Section 40) - mapping the
 * result plus the rest of an override (`permission`/`risk`/`reversibility`/`dataClassification`)
 * into a full `ToolSecurityManifest` is `security-metadata.ts`'s job, not this one's.
 */
export function resolveOperationExposure(
  candidate: OpenAPIOperationCandidate,
  options: ExposurePolicyOptions = {},
): ExposureDecision {
  const key = operationKey(candidate);
  const override = options.operations?.[key];

  if (options.exclude?.includes(key)) {
    return { exposure: 'deny', reason: `"${key}" is explicitly excluded.`, override };
  }
  if (options.include !== undefined && !options.include.includes(key)) {
    return { exposure: 'deny', reason: `"${key}" is not on the explicit allowlist.`, override };
  }
  if (override?.expose === false) {
    return { exposure: 'deny', reason: `"${key}" has expose: false.`, override };
  }

  const methodDefault = options.policies?.[candidate.method] ?? BUILTIN_METHOD_DEFAULTS[candidate.method];

  const hasExplicitIntent =
    override?.expose === true ||
    override?.approval !== undefined ||
    override?.permission !== undefined ||
    override?.risk !== undefined;

  if (hasExplicitIntent) {
    if (override?.approval === 'none') {
      return { exposure: 'allow', reason: `"${key}" override sets approval: "none".`, override };
    }
    if (override?.approval !== undefined) {
      return { exposure: 'approval', reason: `"${key}" override sets approval: "${override.approval}".`, override };
    }
    if (methodDefault === 'deny') {
      return {
        exposure: 'approval',
        reason: `"${key}" is explicitly opted in from a deny-by-default method (${candidate.method.toUpperCase()}) - conservatively requires approval.`,
        override,
      };
    }
  }

  return { exposure: methodDefault, reason: `Method default for ${candidate.method.toUpperCase()}.`, override };
}
