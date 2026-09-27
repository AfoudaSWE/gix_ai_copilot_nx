import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Write-only secret storage for the platform (Section 86): browser -> TLS -> server -> this
 * store. Values are never returned through the management API, never logged, and never kept
 * as database plaintext. Reading a value is a server-side runtime concern (`reveal`), used
 * when building provider adapters.
 */
export interface SecretStore {
  put(tenantId: string, name: string, value: string): Promise<void>;
  /** Metadata only: whether a secret exists and when it was last set. */
  describe(tenantId: string, name: string): Promise<{ readonly configured: boolean; readonly updatedAt?: string }>;
  list(tenantId: string): Promise<readonly { readonly name: string; readonly updatedAt: string }[]>;
  delete(tenantId: string, name: string): Promise<boolean>;
  /** Server-side only. Never exposed through an HTTP route. */
  reveal(tenantId: string, name: string): Promise<string | undefined>;
}

/** Where ciphertext rows live (in memory, or the PostgreSQL `secrets` table). */
export interface EncryptedSecretRepository {
  save(row: EncryptedSecretRow): Promise<void>;
  get(tenantId: string, name: string): Promise<EncryptedSecretRow | undefined>;
  list(tenantId: string): Promise<readonly EncryptedSecretRow[]>;
  delete(tenantId: string, name: string): Promise<boolean>;
}

export interface EncryptedSecretRow {
  readonly tenantId: string;
  readonly name: string;
  readonly ciphertext: string;
  readonly iv: string;
  readonly tag: string;
  readonly keyVersion: string;
  readonly updatedAt: string;
}

export function createInMemorySecretRepository(): EncryptedSecretRepository {
  const rows = new Map<string, EncryptedSecretRow>();
  const key = (tenantId: string, name: string): string => `${tenantId}\u0000${name}`;
  return {
    save: (row) => Promise.resolve(void rows.set(key(row.tenantId, row.name), row)),
    get: (tenantId, name) => Promise.resolve(rows.get(key(tenantId, name))),
    list: (tenantId) => Promise.resolve([...rows.values()].filter((row) => row.tenantId === tenantId)),
    delete: (tenantId, name) => Promise.resolve(rows.delete(key(tenantId, name))),
  };
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * AES-256-GCM envelope with a key from your secret manager (32 bytes, base64). The tenant id
 * and secret name are bound as additional authenticated data, so a ciphertext copied to another
 * tenant or name fails to decrypt. Rotate by adding a new `keys` entry and re-putting values.
 */
export function createEncryptedSecretStore(options: {
  readonly repository: EncryptedSecretRepository;
  readonly keys: Readonly<Record<string, string>>;
  readonly activeKeyVersion: string;
  readonly now?: () => Date;
}): SecretStore {
  const keyFor = (version: string): Buffer => {
    const encoded = options.keys[version];
    if (!encoded) throw new Error(`Unknown secret key version "${version}".`);
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) throw new Error('Secret encryption keys must be 32 bytes (base64).');
    return key;
  };
  keyFor(options.activeKeyVersion);
  const now = options.now ?? (() => new Date());
  const aad = (tenantId: string, name: string): Buffer => Buffer.from(`${tenantId}\u0000${name}`);
  const check = (name: string): void => {
    if (!NAME.test(name)) throw new Error('Invalid secret name.');
  };

  return {
    async put(tenantId, name, value) {
      check(name);
      if (value.length === 0 || value.length > 16_384) throw new Error('Secret value must be 1-16384 characters.');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', keyFor(options.activeKeyVersion), iv);
      cipher.setAAD(aad(tenantId, name));
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      await options.repository.save({
        tenantId,
        name,
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        keyVersion: options.activeKeyVersion,
        updatedAt: now().toISOString(),
      });
    },
    async describe(tenantId, name) {
      const row = await options.repository.get(tenantId, name);
      return row ? { configured: true, updatedAt: row.updatedAt } : { configured: false };
    },
    async list(tenantId) {
      return (await options.repository.list(tenantId)).map((row) => ({ name: row.name, updatedAt: row.updatedAt }));
    },
    delete: (tenantId, name) => options.repository.delete(tenantId, name),
    async reveal(tenantId, name) {
      const row = await options.repository.get(tenantId, name);
      if (!row) return undefined;
      const decipher = createDecipheriv('aes-256-gcm', keyFor(row.keyVersion), Buffer.from(row.iv, 'base64'));
      decipher.setAAD(aad(tenantId, name));
      decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    },
  };
}
