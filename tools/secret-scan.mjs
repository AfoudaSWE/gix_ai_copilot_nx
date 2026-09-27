#!/usr/bin/env node
// Repository secret scan (Phase 12 Section 164): checks every tracked or unignored file for
// credential-shaped strings. It reports the file, line and kind of finding, NEVER the matched
// value. Obvious test fixtures (values containing "test", "example", "fake", "dummy",
// "placeholder", "not-a-real" or runs of zeros) are ignored. A heuristic, not a guarantee:
// pair it with your platform's secret scanning.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const PATTERNS = [
  ['OpenAI-style API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g],
  ['Anthropic-style API key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/g],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['Credential in URL', /\b(?:postgres(?:ql)?|redis|mysql|mongodb(?:\+srv)?|amqp):\/\/[^:\s/'"`]+:[^@\s'"`$]{6,}@[^\s'"`]+/g],
];
const ALLOW = /test|example|fake|dummy|placeholder|not-a-real|abcdefgh|0000000|xxxxxx|localhost|127\.0\.0\.1|\$\{|<|password@|pw@|pass@|:p@|:pw@/i;
// Redaction/memory tests assert that PEM blocks are rejected, so spec files may contain one.
const FIXTURE_FILES = /\.spec\.[cm]?[jt]sx?$/;
const SKIP = /(^|\/)(pnpm-lock\.yaml|.*\.(png|jpg|jpeg|gif|ico|woff2?|pdf|docx|tgz|zip))$/i;

const files = [
  ...execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n'),
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n'),
].filter((file) => file && !SKIP.test(file));

const findings = [];
for (const file of new Set(files)) {
  let text;
  try {
    if (statSync(file).size > 2_000_000) continue;
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const [kind, pattern] of PATTERNS) {
      for (const match of line.matchAll(pattern)) {
        if (ALLOW.test(match[0])) continue;
        if (kind === 'Private key block' && FIXTURE_FILES.test(file)) continue;
        findings.push({ file, line: index + 1, kind });
      }
    }
  });
}

for (const finding of findings) console.log(`${finding.file}:${finding.line}  possible ${finding.kind}`);
console.log(`secret scan: ${files.length} files checked, ${findings.length} findings`);
process.exit(findings.length > 0 ? 1 : 0);
