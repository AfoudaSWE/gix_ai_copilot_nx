import { describe, expect, it } from 'vitest';
import { ToolCallAssembler } from './tool-call-assembler.js';

describe('ToolCallAssembler', () => {
  it('assembles a tool call streamed as fragmented argument-JSON deltas', () => {
    const assembler = new ToolCallAssembler();
    assembler.push({ index: 0, id: 'call-1', name: 'applications.getStatus' });
    assembler.push({ index: 0, argumentsDelta: '{"applicationId":' });
    assembler.push({ index: 0, argumentsDelta: '"APP-1024"}' });

    const calls = assembler.finalize();
    expect(calls).toEqual([
      { id: 'call-1', name: 'applications.getStatus', arguments: { applicationId: 'APP-1024' } },
    ]);
  });

  it('assembles multiple parallel tool calls in index order', () => {
    const assembler = new ToolCallAssembler();
    assembler.push({ index: 1, id: 'call-2', name: 'b', argumentsDelta: '{}' });
    assembler.push({ index: 0, id: 'call-1', name: 'a', argumentsDelta: '{}' });

    const calls = assembler.finalize();
    expect(calls.map((call) => call.id)).toEqual(['call-1', 'call-2']);
  });

  it('treats an empty arguments string as an empty object', () => {
    const assembler = new ToolCallAssembler();
    assembler.push({ index: 0, id: 'call-1', name: 'noArgs' });
    expect(assembler.finalize()).toEqual([{ id: 'call-1', name: 'noArgs', arguments: {} }]);
  });

  it('rejects a tool call missing an id or name once finalized', () => {
    const assembler = new ToolCallAssembler();
    assembler.push({ index: 0, argumentsDelta: '{}' });
    expect(() => assembler.finalize()).toThrow(/missing id or name/);
  });

  it('rejects malformed argument JSON rather than silently dropping the call', () => {
    const assembler = new ToolCallAssembler();
    assembler.push({ index: 0, id: 'call-1', name: 'x', argumentsDelta: '{not-json' });
    expect(() => assembler.finalize()).toThrow(/not valid JSON/);
  });

  it('rejects arguments that parse to a non-object JSON value', () => {
    const assembler = new ToolCallAssembler();
    assembler.push({ index: 0, id: 'call-1', name: 'x', argumentsDelta: '"just a string"' });
    expect(() => assembler.finalize()).toThrow(/must be a JSON object/);
  });

  it('reports isEmpty accurately', () => {
    const assembler = new ToolCallAssembler();
    expect(assembler.isEmpty).toBe(true);
    assembler.push({ index: 0, id: 'call-1', name: 'x' });
    expect(assembler.isEmpty).toBe(false);
  });
});
