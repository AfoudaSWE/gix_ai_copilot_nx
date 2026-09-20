import { describe, expect, it } from 'vitest';
import { CopilotError } from '@gixcopilot/protocol';
import { normalizeMcpError, normalizeMcpToolFailure } from './error-normalization.js';
import type { McpErrorContext } from './error-normalization.js';

const context: McpErrorContext = { serverId: 'github', toolName: 'searchIssues' };

describe('normalizeMcpError', () => {
  it('passes an already-normalized CopilotError through unchanged', () => {
    const original = CopilotError.validation('bad input');
    expect(normalizeMcpError(original, context)).toBe(original);
  });

  it('maps an AbortError DOMException to CANCELLED', () => {
    expect(normalizeMcpError(new DOMException('Aborted', 'AbortError'), context).code).toBe('CANCELLED');
  });

  it('maps MCP RequestTimeout (-32001) to TIMEOUT', () => {
    const error = normalizeMcpError({ code: -32001, message: 'timed out' }, context);
    expect(error.code).toBe('TIMEOUT');
  });

  it('maps MCP ConnectionClosed (-32000) to NETWORK_ERROR', () => {
    const error = normalizeMcpError({ code: -32000, message: 'closed' }, context);
    expect(error.code).toBe('NETWORK_ERROR');
  });

  it('maps MCP MethodNotFound (-32601) to TOOL_EXECUTION_ERROR', () => {
    const error = normalizeMcpError({ code: -32601, message: 'not found' }, context);
    expect(error.code).toBe('TOOL_EXECUTION_ERROR');
  });

  it('maps MCP InvalidParams (-32602) to VALIDATION_ERROR', () => {
    const error = normalizeMcpError({ code: -32602, message: 'bad args' }, context);
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('maps MCP ParseError/InvalidRequest/InternalError to PROTOCOL_ERROR', () => {
    for (const code of [-32700, -32600, -32603]) {
      expect(normalizeMcpError({ code, message: 'x' }, context).code).toBe('PROTOCOL_ERROR');
    }
  });

  it('maps an unknown numeric MCP error code to TOOL_EXECUTION_ERROR', () => {
    expect(normalizeMcpError({ code: -1, message: 'weird' }, context).code).toBe('TOOL_EXECUTION_ERROR');
  });

  it('maps a generic Error to NETWORK_ERROR', () => {
    const error = normalizeMcpError(new TypeError('connection refused'), context);
    expect(error.code).toBe('NETWORK_ERROR');
  });

  it('maps a non-Error throw to INTERNAL_ERROR', () => {
    expect(normalizeMcpError('a string was thrown', context).code).toBe('INTERNAL_ERROR');
  });
});

describe('normalizeMcpToolFailure', () => {
  it('produces a TOOL_EXECUTION_ERROR describing the tool failure', () => {
    const error = normalizeMcpToolFailure('boom', context);
    expect(error.code).toBe('TOOL_EXECUTION_ERROR');
    expect(error.message).toContain('searchIssues');
    expect(error.message).not.toContain('boom');
  });
});
