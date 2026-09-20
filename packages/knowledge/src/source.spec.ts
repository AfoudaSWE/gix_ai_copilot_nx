import { describe, expect, it } from 'vitest';
import { pdfSource, textSource } from './source.js';

describe('source factories', () => {
  it('assigns a generated id when none is given', () => {
    const source = textSource({ content: 'hello' });
    expect(source.id).toBeTruthy();
    expect(source.type).toBe('text');
    expect(source.config.content).toBe('hello');
  });

  it('uses a caller-supplied id', () => {
    const source = textSource({ id: 'my-id', content: 'hello' });
    expect(source.id).toBe('my-id');
  });

  it('merges the permissions shorthand into acl.permissions (Section 192)', () => {
    const source = pdfSource({
      path: './handbook.pdf',
      tenantId: 'tenant-a',
      permissions: ['knowledge.hr.read'],
    });
    expect(source.tenantId).toBe('tenant-a');
    expect(source.acl?.permissions).toEqual(['knowledge.hr.read']);
  });

  it('merges permissions shorthand with an explicit acl without duplicating', () => {
    const source = pdfSource({
      path: './handbook.pdf',
      acl: { roles: ['admin'], permissions: ['knowledge.hr.read'] },
      permissions: ['knowledge.hr.read', 'knowledge.hr.write'],
    });
    expect(source.acl?.roles).toEqual(['admin']);
    expect(source.acl?.permissions).toEqual(
      expect.arrayContaining(['knowledge.hr.read', 'knowledge.hr.write']),
    );
    expect(source.acl?.permissions).toHaveLength(2);
  });

  it('leaves acl undefined when no permissions/acl were given', () => {
    const source = textSource({ content: 'hello' });
    expect(source.acl).toBeUndefined();
  });
});
