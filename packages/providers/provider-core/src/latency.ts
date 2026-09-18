/** Runtime-level, provider-independent timing - Section 31. Not a telemetry platform (Phase 11 owns that). */
export interface ModelLatency {
  readonly totalMs: number;
  /** Absent if the model never produced any content (e.g. it failed before the first chunk). */
  readonly timeToFirstChunkMs?: number;
}
