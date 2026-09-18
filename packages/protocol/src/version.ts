/**
 * Explicit protocol version. Centralized here so nothing hard-codes the literal "1"
 * elsewhere - see docs/adr/0003-event-driven-protocol.md for what constitutes a breaking
 * protocol change and how version mismatches should be handled.
 */
export const PROTOCOL_VERSION = '1';

export type ProtocolVersion = typeof PROTOCOL_VERSION;

export function isSupportedProtocolVersion(value: string): value is ProtocolVersion {
  return value === PROTOCOL_VERSION;
}
