import { ATTR } from './conventions.js';

/** Decides, when a ROOT span starts, whether its whole trace is kept (Section 159). Child
 * spans always follow their root's decision. */
export type TraceSampler = (name: string, attributes: Readonly<Record<string, string | number | boolean>>) => boolean;

export const alwaysSample: TraceSampler = () => true;
export const neverSample: TraceSampler = () => false;

/** FNV-1a, 32-bit - a stable, dependency-free hash so one run id always gets one verdict. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/**
 * Keeps roughly `ratio` of traces. The verdict is derived from the root span's run id (or
 * workflow run id) when present, so the same run is always kept or dropped consistently
 * across adapters and processes; roots without an id fall back to a round-robin counter.
 */
export function createRatioSampler(ratio: number): TraceSampler {
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new RangeError('Sampling ratio must be between 0 and 1.');
  if (ratio === 1) return alwaysSample;
  if (ratio === 0) return neverSample;
  const threshold = Math.floor(ratio * 0x1_0000_0000);
  let counter = 0;
  return (_name, attributes) => {
    const key = attributes[ATTR.runId] ?? attributes[ATTR.workflowRunId];
    if (key !== undefined) return hash(String(key)) < threshold;
    counter += 1;
    return (counter * ratio) % 1 < ratio;
  };
}
