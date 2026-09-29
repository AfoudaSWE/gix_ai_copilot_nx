/**
 * Secret scan for generated content (§55). A finding reports the kind and line only, never
 * the matched value, so a scan result is itself safe to show, log or send to a browser.
 */
export interface SecretFinding {
  readonly kind: string;
  readonly line: number;
}

const SECRET_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['OpenAI API key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['AWS access key id', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe secret key', /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['credential assignment', /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*['"`][^'"`\s]{8,}['"`]/i],
  ['connection string with password', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]{3,}@[^\s]+/i],
];

export function scanForSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    for (const [kind, pattern] of SECRET_PATTERNS) {
      if (pattern.test(line)) findings.push({ kind, line: index + 1 });
    }
  });
  return findings;
}

/** Replaces anything that looks like a secret with `[REDACTED]` (for text shown to people). */
export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((result, [, pattern]) => result.replace(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`), '[REDACTED]'), text);
}
