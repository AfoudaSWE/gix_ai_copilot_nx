/** Content-free measurements; callbacks must never log source/query/value payloads. */
export interface KnowledgeMeasurement {
  readonly stage: string;
  readonly durationMs: number;
  readonly status: 'success' | 'error';
}
export type KnowledgeObserver = (measurement: KnowledgeMeasurement) => void;

/** Measures an adapter stage without exposing inputs or changing behavior on observer failure. */
export async function measureKnowledge<T>(stage: string, observer: KnowledgeObserver | undefined, operation: () => Promise<T>): Promise<T> {
  const start = performance.now();
  let status: KnowledgeMeasurement['status'] = 'success';
  try {
    return await operation();
  } catch (error) {
    status = 'error';
    throw error;
  } finally {
    try { observer?.({ stage, durationMs: performance.now() - start, status }); } catch { /* Telemetry is best effort. */ }
  }
}
