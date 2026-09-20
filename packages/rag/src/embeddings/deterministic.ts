import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from './embedding-provider.js';

/**
 * Hash-based, network-free embedding provider (Section 36) - automated tests must not depend on
 * OpenAI. Deterministic: the same text always produces the same vector, and semantically similar
 * short strings sharing tokens will have non-zero cosine similarity (each token contributes to a
 * fixed set of dimensions via its hash), which is enough for retrieval-pipeline tests without
 * claiming real semantic understanding. Clearly test infrastructure, never used as a production
 * embedding provider.
 */
export interface DeterministicEmbeddingProviderOptions {
  readonly dimensions?: number;
}

function hashToUnitVector(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = text.toLowerCase().split(/\W+/).filter((token) => token.length > 0);
  for (const token of tokens) {
    const digest = createHash('sha256').update(token, 'utf8').digest();
    for (let i = 0; i < dimensions; i++) {
      const byte = digest[i % digest.length] ?? 0;
      // Center around 0 so cosine similarity is meaningful (an all-positive vector would make
      // every pair of texts look artificially similar).
      vector[i] = (vector[i] ?? 0) + (byte - 128);
    }
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}

export function createDeterministicEmbeddingProvider(
  options: DeterministicEmbeddingProviderOptions = {},
): EmbeddingProvider {
  const dimensions = options.dimensions ?? 32;
  return {
    provider: 'deterministic-test',
    model: 'hash-v1',
    dimensions,
    // eslint-disable-next-line @typescript-eslint/require-await -- EmbeddingProvider is async so a real provider's network call fits the same interface
    async embedDocuments(texts: readonly string[]): Promise<number[][]> {
      return texts.map((text) => hashToUnitVector(text, dimensions));
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async embedQuery(text: string): Promise<number[]> {
      return hashToUnitVector(text, dimensions);
    },
  };
}
