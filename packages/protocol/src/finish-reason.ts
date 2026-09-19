/**
 * Normalized, provider-independent reason a model run stopped producing output. Provider
 * adapters (see @gixcopilot/provider-*) map their own finish-reason vocabulary onto this
 * fixed set; a provider-specific raw string may still be retained in provider-level
 * metadata, but never becomes part of this public type - see the ai-runtime skill.
 */
export type FinishReason =
  | 'stop'
  | 'length'
  | 'content_filter'
  | 'cancelled'
  | 'error'
  | 'unknown'
  /**
   * Added in Phase 5 (tools): the model stopped generating text because it requested one or
   * more tool calls, not because it finished its answer - see the tool-system skill.
   */
  | 'tool_calls';
