import { describe, expect, it } from 'vitest';
import { createRunId, createToolCallId } from '@gixcopilot/protocol';
import { createFrontendToolBridge } from './frontend-tool-bridge.js';

describe('createFrontendToolBridge', () => {
  it('resolves awaitResult once submitResult is called for the same runId/toolCallId', async () => {
    const bridge = createFrontendToolBridge();
    const runId = createRunId();
    const toolCallId = createToolCallId();
    const controller = new AbortController();

    const pending = bridge.awaitResult(runId, toolCallId, 'navigation.open', {
      signal: controller.signal,
    });

    const accepted = bridge.submitResult(runId, toolCallId, {
      status: 'success',
      toolCallId,
      data: { opened: true },
    });
    expect(accepted).toBe(true);

    const result = await pending;
    expect(result).toEqual({ status: 'success', toolCallId, data: { opened: true } });
  });

  it('returns false from submitResult for an unknown or already-resolved call', () => {
    const bridge = createFrontendToolBridge();
    const runId = createRunId();
    const toolCallId = createToolCallId();
    expect(bridge.submitResult(runId, toolCallId, { status: 'success', toolCallId, data: {} })).toBe(
      false,
    );
  });

  it('does not resolve a different runId/toolCallId pair (correlation is strict)', async () => {
    const bridge = createFrontendToolBridge();
    const runId = createRunId();
    const toolCallId = createToolCallId();
    const controller = new AbortController();
    const pending = bridge.awaitResult(runId, toolCallId, 'x', { signal: controller.signal });

    const acceptedForOtherRun = bridge.submitResult(createRunId(), toolCallId, {
      status: 'success',
      toolCallId,
      data: {},
    });
    expect(acceptedForOtherRun).toBe(false);

    controller.abort();
    const result = await pending;
    expect(result.status).toBe('error');
  });

  it('resolves with a CANCELLED error when the signal aborts before any result arrives', async () => {
    const bridge = createFrontendToolBridge();
    const runId = createRunId();
    const toolCallId = createToolCallId();
    const controller = new AbortController();

    const pending = bridge.awaitResult(runId, toolCallId, 'x', { signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.status === 'error' && result.error.code).toBe('CANCELLED');
  });

  it('resolves immediately with CANCELLED if the signal is already aborted', async () => {
    const bridge = createFrontendToolBridge();
    const controller = new AbortController();
    controller.abort();
    const result = await bridge.awaitResult(createRunId(), createToolCallId(), 'x', {
      signal: controller.signal,
    });
    expect(result.status === 'error' && result.error.code).toBe('CANCELLED');
  });

  it('resolves with FRONTEND_TOOL_UNAVAILABLE once timeoutMs elapses with no client response', async () => {
    const bridge = createFrontendToolBridge();
    const result = await bridge.awaitResult(createRunId(), createToolCallId(), 'navigation.open', {
      signal: new AbortController().signal,
      timeoutMs: 5,
    });
    expect(result.status === 'error' && result.error.code).toBe('FRONTEND_TOOL_UNAVAILABLE');
  });

  it('never resolves via timeout after the result has already arrived (no late double-resolve)', async () => {
    const bridge = createFrontendToolBridge();
    const runId = createRunId();
    const toolCallId = createToolCallId();
    const pending = bridge.awaitResult(runId, toolCallId, 'x', {
      signal: new AbortController().signal,
      timeoutMs: 50,
    });
    bridge.submitResult(runId, toolCallId, { status: 'success', toolCallId, data: { ok: true } });
    const result = await pending;
    expect(result).toEqual({ status: 'success', toolCallId, data: { ok: true } });
    await new Promise((resolve) => setTimeout(resolve, 60));
    // No assertion needed beyond "this didn't throw/hang" - the timer must have been cleared.
  });
});
