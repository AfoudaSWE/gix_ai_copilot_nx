import type { ToolSecurityManifest } from '@gixcopilot/protocol';
import type { McpToolExposure, McpToolOverride } from './types.js';

export interface McpExposurePolicyOptions {
  /** Default exposure for any tool without its own override (Section 79) - defaults to
   * `"deny"`: an unknown remote MCP tool must not automatically receive unrestricted
   * authority. A developer opts a server's tools in deliberately, either by raising this
   * default or by allowlisting specific tools via `tools`. */
  readonly defaultExposure?: McpToolExposure;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly tools?: Readonly<Record<string, McpToolOverride>>;
}

export interface McpExposureDecision {
  readonly exposure: McpToolExposure;
  readonly reason: string;
  readonly override?: McpToolOverride;
}

/**
 * Resolves the allow/approval/deny exposure for one MCP tool (Section 78-79). Precedence,
 * deny-wins throughout, mirroring `@gixcopilot/openapi`'s `resolveOperationExposure`:
 *
 * 1. An explicit `exclude` entry always denies, even if the same tool is also in `include`.
 * 2. When `include` is provided, any tool absent from it is denied (a closed allowlist).
 * 3. `tools[name].expose === false` denies, regardless of the default.
 * 4. An explicit `approval`/`permission`/`risk` override opts the tool in even past a `"deny"`
 *    default - `approval: "none"` allows it outright; any other explicit `approval` requires
 *    approval; otherwise it falls through to the configured default.
 * 5. Otherwise, `defaultExposure` applies (Section 79's conservative default is `"deny"`).
 */
export function resolveMcpToolExposure(toolName: string, options: McpExposurePolicyOptions = {}): McpExposureDecision {
  const override = options.tools?.[toolName];
  const defaultExposure = options.defaultExposure ?? 'deny';

  if (options.exclude?.includes(toolName)) {
    return { exposure: 'deny', reason: `"${toolName}" is explicitly excluded.`, override };
  }
  if (options.include !== undefined && !options.include.includes(toolName)) {
    return { exposure: 'deny', reason: `"${toolName}" is not on the explicit allowlist.`, override };
  }
  if (override?.expose === false) {
    return { exposure: 'deny', reason: `"${toolName}" has expose: false.`, override };
  }

  const hasExplicitIntent =
    options.include?.includes(toolName) === true || override?.expose === true || override?.approval !== undefined || override?.permission !== undefined || override?.risk !== undefined;

  if (hasExplicitIntent) {
    if (override?.approval === 'none') {
      return { exposure: 'allow', reason: `"${toolName}" override sets approval: "none".`, override };
    }
    if (override?.approval !== undefined) {
      return { exposure: 'approval', reason: `"${toolName}" override sets approval: "${override.approval}".`, override };
    }
    if (defaultExposure === 'deny') {
      return {
        exposure: 'approval',
        reason: `"${toolName}" is explicitly opted in from a deny-by-default server - conservatively requires approval.`,
        override,
      };
    }
  }

  return { exposure: defaultExposure, reason: 'Server default exposure.', override };
}

export interface McpSecurityMetadataOptions {
  readonly serverId: string;
  /** Default permission applied when the tool's override sets neither `requiredPermissions`
   * nor `permission` (mirrors `@gixcopilot/openapi`'s `SecurityMetadataOptions` - no generated
   * tool is ever permission-less by accident). Defaults to `mcp.<serverId>`. */
  readonly defaultPermission?: string | ((toolName: string) => string);
}

function defaultPermissionFor(toolName: string, options: McpSecurityMetadataOptions): string {
  if (typeof options.defaultPermission === 'function') return options.defaultPermission(toolName);
  return options.defaultPermission ?? `mcp.${options.serverId}`;
}

/**
 * Maps an MCP tool's exposure decision and override into a `ToolSecurityManifest` (Section 78,
 * mirroring `@gixcopilot/openapi`'s `buildSecurityMetadata`). Unlike OpenAPI, there is no HTTP
 * method to derive a safe default `risk` from (Section 47 has no MCP equivalent) - an MCP
 * tool's risk is `undefined` unless the override declares one, which Phase 7's own risk policy
 * already treats as "unclassified" and fails closed to its strictest ordinary default (see
 * `@gixcopilot/security`'s `createDefaultRiskPolicy`) - exactly the conservative behavior
 * Section 79 asks for, reusing existing policy rather than inventing a new one.
 */
export function buildMcpSecurityMetadata(
  toolName: string,
  decision: McpExposureDecision,
  options: McpSecurityMetadataOptions,
): ToolSecurityManifest {
  const override = decision.override;
  const requiredPermissions =
    override?.requiredPermissions ??
    (override?.permission !== undefined ? [override.permission] : [defaultPermissionFor(toolName, options)]);

  return {
    requiredPermissions,
    risk: override?.risk,
    reversibility: override?.reversibility,
    approval: override?.approval ?? (decision.exposure === 'approval' && override?.risk === 'read-only' ? 'user-confirmation' : undefined),
    dataClassification: override?.dataClassification,
  };
}
