import { isToolEnabled } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolResolver } from '@gixcopilot/tools';
import type { Identity } from './identity.js';
import { hasAllPermissions } from './permissions.js';
import type { RolePermissionMap } from './permissions.js';

export interface PermissionAwareResolverOptions {
  readonly roleMap?: RolePermissionMap;
}

/**
 * Section 20's discovery boundary: wraps any `ToolResolver` (backend registry, frontend
 * manifest, or their combination) so a tool declaring `security.requiredPermissions` the
 * given identity does not hold is filtered out *before* the model ever sees it - never sent
 * in the tools list at all, not merely rejected later. A tool with no `security` metadata (or
 * no `requiredPermissions`) is unaffected - declaring no requirement means "available to
 * everyone," exactly like every other Phase 5 tool before this package existed.
 *
 * This is discovery-time filtering only (Section 20) - it is not itself enforcement. Every
 * call must still be re-authorized at execution time by the Action Firewall (Section 21's
 * defense in depth) even for a tool this resolver would have hidden.
 */
export function createPermissionAwareToolResolver(
  resolver: ToolResolver,
  identity: Identity | undefined,
  options: PermissionAwareResolverOptions = {},
): ToolResolver {
  return {
    async resolve(context) {
      const tools = await resolver.resolve(context);
      return tools.filter((tool: AnyToolDefinition) => {
        if (!isToolEnabled(tool)) return false;
        const required = tool.security?.requiredPermissions;
        if (!required || required.length === 0) return true;
        return hasAllPermissions(identity, required, options.roleMap);
      });
    },
  };
}
