import type { DataClassification, ToolActionRisk, ToolActionReversibility, ToolApprovalLevel } from '@gixcopilot/protocol';
import type { JsonSchemaLike } from '@gixcopilot/tools';

export type McpConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'closing';

/**
 * Transports this package actually constructs (Section 71) - limited to the two the installed
 * SDK ships as first-class client transports for a standalone Node process (`stdio`,
 * `streamableHttp`); the SDK's legacy `sse` and `websocket` transports are deliberately not
 * wrapped here, matching "do not invent transport names or protocols... follow the installed
 * MCP SDK" without expanding surface area the phase does not require.
 */
export type McpTransportConfig =
  | {
      readonly kind: 'stdio';
      readonly command: string;
      readonly args?: readonly string[];
      readonly env?: Readonly<Record<string, string>>;
      readonly cwd?: string;
    }
  | {
      readonly kind: 'streamableHttp';
      readonly url: string;
    };

/** Diagnostic/policy-only classification (Section 90) - never itself a bypass of the Action
 * Firewall; "trusted" changes nothing about enforcement, only what a developer/report sees. */
export type McpServerTrustLevel = 'trusted' | 'internal' | 'external';

/** One tool as discovered from a connected MCP server, before any naming/policy/schema
 * conversion decision has been made (Section 73's "preserve name/description/input schema"). */
export interface McpToolCandidate {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JsonSchemaLike;
}

/** Preserved on every generated tool via `ToolMetadata.custom` (Section 50-51's OpenAPI
 * equivalent, mirrored here) - never a new top-level `ToolMetadata` field. */
export interface McpToolSourceMetadata {
  readonly sourceType: 'mcp';
  readonly serverId: string;
  readonly toolName: string;
  readonly serverTrustLevel?: McpServerTrustLevel;
}

export type McpToolExposure = 'allow' | 'approval' | 'deny';

/** Per-tool override (Section 78), keyed by the tool's raw name as the MCP server reports it -
 * stable regardless of whatever namespace this package wraps it in (mirrors
 * `@gixcopilot/openapi`'s `operationKey` convention). */
export interface McpToolOverride {
  readonly expose?: boolean;
  readonly permission?: string;
  readonly requiredPermissions?: readonly string[];
  readonly risk?: ToolActionRisk;
  readonly reversibility?: ToolActionReversibility;
  readonly approval?: ToolApprovalLevel;
  readonly dataClassification?: DataClassification;
  readonly name?: string;
  readonly description?: string;
}

export interface RegistrationWarning {
  readonly operation: string;
  readonly message: string;
}

export interface RegistrationConflict {
  readonly name: string;
  readonly operations: readonly string[];
}

export interface ConnectionIssue {
  readonly message: string;
}

export interface McpGenerationReport {
  readonly serverId: string;
  /** Set when the server could not be connected to / discovery failed entirely - every other
   * count is `0` when this is set, mirroring `@gixcopilot/openapi`'s `documentIssues`. */
  readonly connectionIssue?: ConnectionIssue;
  readonly toolsDiscovered: number;
  readonly generated: number;
  readonly skipped: number;
  readonly denied: number;
  readonly unsupported: number;
  readonly warnings: readonly RegistrationWarning[];
  readonly conflicts: readonly RegistrationConflict[];
}
