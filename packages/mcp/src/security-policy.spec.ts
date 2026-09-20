import { describe, expect, it } from 'vitest';
import { buildMcpSecurityMetadata, resolveMcpToolExposure } from './security-policy.js';

describe('resolveMcpToolExposure', () => {
  it('defaults to deny for an unknown tool with no configuration at all', () => {
    expect(resolveMcpToolExposure('searchIssues').exposure).toBe('deny');
  });

  it('respects a raised defaultExposure', () => {
    expect(resolveMcpToolExposure('searchIssues', { defaultExposure: 'allow' }).exposure).toBe('allow');
  });

  it('exclude always wins, even if the same tool is also included', () => {
    const result = resolveMcpToolExposure('searchIssues', {
      defaultExposure: 'allow',
      include: ['searchIssues'],
      exclude: ['searchIssues'],
    });
    expect(result.exposure).toBe('deny');
  });

  it('a tool absent from an explicit include list is denied', () => {
    const result = resolveMcpToolExposure('createIssue', { defaultExposure: 'allow', include: ['searchIssues'] });
    expect(result.exposure).toBe('deny');
  });

  it('tools[name].expose === false denies regardless of default', () => {
    const result = resolveMcpToolExposure('searchIssues', {
      defaultExposure: 'allow',
      tools: { searchIssues: { expose: false } },
    });
    expect(result.exposure).toBe('deny');
  });

  it('an explicit expose:true opts a tool in from a deny default, but only to approval, never allow', () => {
    const result = resolveMcpToolExposure('createIssue', { tools: { createIssue: { expose: true } } });
    expect(result.exposure).toBe('approval');
  });

  it('an override with approval: "none" allows a tool despite a deny default', () => {
    const result = resolveMcpToolExposure('searchIssues', { tools: { searchIssues: { approval: 'none' } } });
    expect(result.exposure).toBe('allow');
  });

  it('an override with an explicit approval level requires approval', () => {
    const result = resolveMcpToolExposure('createIssue', {
      defaultExposure: 'allow',
      tools: { createIssue: { approval: 'user-confirmation' } },
    });
    expect(result.exposure).toBe('approval');
  });

  it('carries the resolved override through the decision', () => {
    const override = { permission: 'github.issue.create', approval: 'user-confirmation' as const, risk: 'write' as const };
    const result = resolveMcpToolExposure('createIssue', { tools: { createIssue: override } });
    expect(result.override).toEqual(override);
  });
});

describe('buildMcpSecurityMetadata', () => {
  it('never generates a permission-less manifest - falls back to a server-scoped default', () => {
    const decision = resolveMcpToolExposure('searchIssues', { defaultExposure: 'allow' });
    const metadata = buildMcpSecurityMetadata('searchIssues', decision, { serverId: 'github' });
    expect(metadata.requiredPermissions).toEqual(['mcp.github']);
  });

  it('uses a custom default-permission function', () => {
    const decision = resolveMcpToolExposure('searchIssues', { defaultExposure: 'allow' });
    const metadata = buildMcpSecurityMetadata('searchIssues', decision, {
      serverId: 'github',
      defaultPermission: (name) => `github.${name}`,
    });
    expect(metadata.requiredPermissions).toEqual(['github.searchIssues']);
  });

  it('leaves risk undefined when the override does not declare one - no HTTP-method-style default exists for MCP', () => {
    const decision = resolveMcpToolExposure('searchIssues', { defaultExposure: 'allow' });
    const metadata = buildMcpSecurityMetadata('searchIssues', decision, { serverId: 'github' });
    expect(metadata.risk).toBeUndefined();
  });

  it('carries an explicit override risk/approval/dataClassification through unchanged', () => {
    const decision = resolveMcpToolExposure('createIssue', {
      tools: { createIssue: { risk: 'write', approval: 'user-confirmation', dataClassification: 'internal' } },
    });
    const metadata = buildMcpSecurityMetadata('createIssue', decision, { serverId: 'github' });
    expect(metadata.risk).toBe('write');
    expect(metadata.approval).toBe('user-confirmation');
    expect(metadata.dataClassification).toBe('internal');
  });
});
