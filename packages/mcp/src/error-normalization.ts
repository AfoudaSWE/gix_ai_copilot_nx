import { CopilotError } from '@gixcopilot/protocol';

export interface McpErrorContext {
  readonly serverId: string;
  readonly toolName?: string;
}

/** The JSON-RPC error codes the installed MCP SDK defines (`ErrorCode` in
 * `@modelcontextprotocol/sdk`) - duplicated as plain numbers rather than importing the SDK's
 * enum, since `error-normalization.ts`'s whole job is to translate SDK-shaped errors into this
 * package's own contracts without leaking an SDK type into a public signature (Section 69). */
const MCP_ERROR_CODE = {
  connectionClosed: -32000,
  requestTimeout: -32001,
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

function isMcpErrorShape(error: unknown): error is { readonly code: number; readonly message: string } {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'number';
}

/**
 * Normalizes an error thrown by the MCP client (connection failure, server unavailable, tool
 * not found, invalid arguments, protocol failure, timeout, cancellation - Section 82) into the
 * SDK's existing `CopilotError` taxonomy, never a bespoke MCP-specific error type (mirrors
 * `@gixcopilot/openapi`'s `normalizeExecutionError`).
 */
export function normalizeMcpError(error: unknown, context: McpErrorContext): CopilotError {
  if (CopilotError.isCopilotError(error)) return error;

  const label = context.toolName !== undefined ? `MCP tool "${context.toolName}" on server "${context.serverId}"` : `MCP server "${context.serverId}"`;

  if (error instanceof DOMException && error.name === 'AbortError') {
    return CopilotError.cancelled(`Call to ${label} was cancelled.`);
  }

  if (isMcpErrorShape(error)) {
    switch (error.code) {
      case MCP_ERROR_CODE.requestTimeout:
        return CopilotError.timeout(`${label} timed out.`);
      case MCP_ERROR_CODE.connectionClosed:
        return CopilotError.networkError(`Connection to ${label} closed unexpectedly.`);
      case MCP_ERROR_CODE.methodNotFound:
        return CopilotError.toolExecutionError(`${label}: method not found.`, {
          serverId: context.serverId,
          tool: context.toolName,
          mcpErrorCode: error.code,
        });
      case MCP_ERROR_CODE.invalidParams:
        return CopilotError.validation(`${label} rejected the given arguments.`, {
          serverId: context.serverId,
          tool: context.toolName,
          mcpErrorCode: error.code,
        });
      case MCP_ERROR_CODE.parseError:
      case MCP_ERROR_CODE.invalidRequest:
      case MCP_ERROR_CODE.internalError:
        return CopilotError.protocol(`${label} reported a protocol failure.`, {
          serverId: context.serverId,
          tool: context.toolName,
          mcpErrorCode: error.code,
        });
      default:
        return CopilotError.toolExecutionError(`${label} reported an external error.`, {
          serverId: context.serverId,
          tool: context.toolName,
          mcpErrorCode: error.code,
        });
    }
  }

  if (error instanceof Error) {
    return CopilotError.networkError(`Failed to reach ${label}.`);
  }
  return CopilotError.internal(`Unexpected error from ${label}.`);
}

/** A tool result with `isError: true` (Section 82's "tool failure", distinct from a transport/
 * protocol-level error) - normalized separately since the MCP call itself succeeded; only the
 * tool's own logic reported failure. */
export function normalizeMcpToolFailure(_message: string, context: McpErrorContext): CopilotError {
  return CopilotError.toolExecutionError(
    `MCP tool "${context.toolName ?? 'unknown'}" on server "${context.serverId}" reported a tool failure.`,
    { serverId: context.serverId, tool: context.toolName },
  );
}
