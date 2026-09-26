import type { Evaluator, ExecutionRecord } from '../types.js';
import { defineEvaluator, ratio, result, skipped } from './common.js';

const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'also', 'been', 'before', 'being', 'both', 'could', 'does', 'each', 'from', 'have',
  'having', 'here', 'into', 'more', 'most', 'once', 'only', 'other', 'over', 'same', 'should', 'some', 'such', 'than',
  'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'under', 'until', 'very', 'were',
  'what', 'when', 'where', 'which', 'while', 'will', 'with', 'would', 'your', 'currently', 'please', 'thanks',
]);

function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{3,}/g) ?? []).filter((word) => !STOPWORDS.has(word));
}

function claims(answer: string): string[] {
  return answer
    .replace(/\[S\d+\]/g, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => contentWords(sentence).length >= 3);
}

/** Everything the answer could legitimately be grounded in: retrieved excerpts and tool results. */
function evidenceCorpus(record: ExecutionRecord): Set<string> {
  const texts = [
    ...record.retrievedSources.map((source) => source.excerpt ?? ''),
    ...record.tools.filter((tool) => tool.executed && tool.result !== undefined).map((tool) => JSON.stringify(tool.result)),
  ];
  return new Set(texts.flatMap(contentWords));
}

/**
 * Section 103: is each claim in the answer supported by the supplied sources? Deterministic
 * lexical-evidence check - a claim is supported when most of its content words appear in the
 * retrieved excerpts or tool results. Reported as heuristic: it catches unsupported claims
 * reliably, but word overlap is a proxy for support, not proof of it.
 */
export function groundednessEvaluator(options: { readonly threshold?: number; readonly claimSupport?: number } = {}): Evaluator {
  const self = { id: 'groundedness', metric: 'groundedness', heuristic: true };
  const threshold = options.threshold ?? 0.8;
  const claimSupport = options.claimSupport ?? 0.6;
  return defineEvaluator({
    ...self,
    applies: (evalCase) => (evalCase.expected?.sources?.length ?? 0) > 0 || evalCase.expected?.requireCitations === true,
    evaluate({ record }) {
      if (!record.answer) return skipped(self, 'No answer to evaluate.');
      const corpus = evidenceCorpus(record);
      const list = claims(record.answer);
      if (list.length === 0) return skipped(self, 'The answer makes no substantive claims.');
      const unsupported = list.filter((claim) => {
        const words = contentWords(claim);
        return ratio(words.filter((word) => corpus.has(word)).length, words.length) < claimSupport;
      });
      const value = ratio(list.length - unsupported.length, list.length);
      return result(self, {
        value,
        threshold,
        passed: value >= threshold,
        evidence: corpus.size === 0 ? ['No retrieved or tool evidence was available - every claim is unsupported.'] : unsupported.map((claim) => `UNSUPPORTED: ${claim}`),
        details: { method: 'lexical-evidence-overlap', claims: list.length, unsupported: unsupported.length, claimSupport },
      });
    },
  });
}

/** Section 104: every cited id exists, was retrieved into context, and (where evaluable)
 * the citing sentence overlaps the cited excerpt. */
export function citationEvaluator(): Evaluator {
  const self = { id: 'citations', metric: 'citation_validity' };
  return defineEvaluator({
    ...self,
    applies: (evalCase) => evalCase.expected?.requireCitations === true || (evalCase.expected?.sources?.length ?? 0) > 0,
    evaluate({ evalCase, record }) {
      const answer = record.answer ?? '';
      const cited = [...answer.matchAll(/\[(S\d+)\]/g)].map((match) => match[1] ?? '');
      if (cited.length === 0) {
        const required = evalCase.expected?.requireCitations === true;
        return required
          ? result(self, { value: 0, threshold: 1, passed: false, evidence: ['The answer cites nothing, but citations are required.'] })
          : skipped(self, 'The answer cites nothing.');
      }
      const known = new Map(record.retrievedSources.filter((source) => source.citationId).map((source) => [source.citationId ?? '', source]));
      const invalid = cited.filter((id) => !known.has(id));
      const unsupported = cited.filter((id) => {
        const source = known.get(id);
        if (!source?.excerpt) return false;
        const sentence = answer.split(/(?<=[.!?])\s+/).find((candidate) => candidate.includes(`[${id}]`)) ?? '';
        const words = contentWords(sentence);
        const excerpt = new Set(contentWords(source.excerpt));
        return words.length > 0 && ratio(words.filter((word) => excerpt.has(word)).length, words.length) < 0.3;
      });
      const value = ratio(cited.length - invalid.length, cited.length);
      return result(self, {
        value,
        threshold: 1,
        passed: invalid.length === 0,
        evidence: [...invalid.map((id) => `[${id}] does not map to a retrieved source`), ...unsupported.map((id) => `[${id}] cited sentence barely overlaps its source`)],
        details: { cited, invalid, weakSupport: unsupported },
      });
    },
  });
}

/** Section 105: classic retrieval metrics over the ranked, retrieved sources. */
export function retrievalEvaluator(): Evaluator {
  const self = { id: 'retrieval', metric: 'retrieval_recall_at_k' };
  return defineEvaluator({
    ...self,
    applies: (evalCase) => (evalCase.expected?.sources?.length ?? 0) > 0,
    evaluate({ evalCase, record }) {
      const expected = new Set(evalCase.expected?.sources ?? []);
      const ranked = [...new Map([...record.retrievedSources].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((source) => [source.sourceId, source])).keys()];
      const hits = ranked.filter((id) => expected.has(id));
      const firstHit = ranked.findIndex((id) => expected.has(id));
      const recall = ratio(hits.length, expected.size);
      return result(self, {
        value: recall,
        threshold: 1,
        passed: recall === 1,
        evidence: [`retrieved (ranked): ${ranked.join(', ') || '(none)'}`],
        details: {
          k: ranked.length,
          recallAtK: recall,
          precisionAtK: ratio(hits.length, ranked.length),
          mrr: firstHit === -1 ? 0 : 1 / (firstHit + 1),
          hitRate: hits.length > 0 ? 1 : 0,
        },
      });
    },
  });
}

/** Section 106, 198 (mandatory): for an unauthorized user the restricted-source retrieval
 * rate must be 0, and restricted content must never appear in the answer. */
export function aclRetrievalEvaluator(): Evaluator {
  const self = { id: 'acl-retrieval', metric: 'restricted_source_leaks', security: true };
  return defineEvaluator({
    ...self,
    applies: (evalCase) => (evalCase.expected?.forbiddenSources?.length ?? 0) > 0 || (evalCase.expected?.forbiddenContent?.length ?? 0) > 0,
    evaluate({ evalCase, record }) {
      const forbidden = new Set(evalCase.expected?.forbiddenSources ?? []);
      const retrieved = [...new Set(record.retrievedSources.map((source) => source.sourceId).filter((id) => forbidden.has(id)))];
      const answer = (record.answer ?? '').toLowerCase();
      const leaked = (evalCase.expected?.forbiddenContent ?? []).filter((text) => answer.includes(text.toLowerCase()));
      const violations = retrieved.length + leaked.length;
      return result(self, {
        value: violations === 0 ? 1 : 0,
        threshold: 1,
        passed: violations === 0,
        evidence: [...retrieved.map((id) => `RESTRICTED source retrieved: ${id}`), ...leaked.map((text) => `RESTRICTED content in answer: "${text}"`)],
        details: { violations: { 'restricted-knowledge': violations } },
      });
    },
  });
}
