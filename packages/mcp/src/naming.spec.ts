import { describe, expect, it } from 'vitest';
import { deriveMcpToolName, detectNamingConflicts } from './naming.js';

describe('deriveMcpToolName', () => {
  it('namespaces a tool under mcp.<server>.<tool>', () => {
    expect(deriveMcpToolName('github', 'searchIssues')).toBe('mcp.github.searchIssues');
  });

  it('sanitizes a kebab-case server id and tool name', () => {
    expect(deriveMcpToolName('company-tools', 'create-issue')).toBe('mcp.companyTools.createIssue');
  });

  it('an explicit override name replaces only the tool-name segment', () => {
    expect(deriveMcpToolName('github', 'searchIssues', 'findIssues')).toBe('mcp.github.findIssues');
  });

  it('is stable across repeated derivations', () => {
    expect(deriveMcpToolName('github', 'searchIssues')).toBe(deriveMcpToolName('github', 'searchIssues'));
  });
});

describe('detectNamingConflicts', () => {
  it('reports no conflicts when all names are unique', () => {
    expect(
      detectNamingConflicts([
        { name: 'mcp.github.searchIssues', operation: 'searchIssues' },
        { name: 'mcp.github.createIssue', operation: 'createIssue' },
      ]),
    ).toEqual([]);
  });

  it('reports a conflict when two tools resolve to the same name', () => {
    const conflicts = detectNamingConflicts([
      { name: 'mcp.github.search', operation: 'search-issues' },
      { name: 'mcp.github.search', operation: 'searchIssues' },
    ]);
    expect(conflicts).toEqual([{ name: 'mcp.github.search', operations: ['search-issues', 'searchIssues'] }]);
  });
});
