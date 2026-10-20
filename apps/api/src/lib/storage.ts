import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { StorageEncryption } from '../interfaces/index.ts';

/** Placeholder encryption: stores bytes as-is. Replace before handling real data. */
export class IdentityEncryption implements StorageEncryption {
  readonly key = 'identity';
  async encrypt(plain: Uint8Array) {
    return plain;
  }
  async decrypt(cipher: Uint8Array) {
    return cipher;
  }
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

/** File store keyed by `{tenant_id}/{sha256}`. Identical uploads share one file per tenant. */
export class FileStorage {
  constructor(
    private root: string,
    private encryption: StorageEncryption = new IdentityEncryption(),
  ) {}

  static keyFor(tenantId: string, hash: string) {
    if (!SAFE_SEGMENT.test(tenantId) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid storage key');
    return `${tenantId}/${hash}`;
  }

  async put(tenantId: string, bytes: Uint8Array): Promise<{ key: string; sha256: string }> {
    const hash = sha256(bytes);
    const key = FileStorage.keyFor(tenantId, hash);
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, await this.encryption.encrypt(bytes, { tenantId }));
    return { key, sha256: hash };
  }

  async get(tenantId: string, key: string): Promise<Uint8Array> {
    // A key from another tenant is never readable, even if someone guesses it.
    if (!key.startsWith(`${tenantId}/`)) throw new Error('Storage key does not belong to tenant');
    const [, hash] = key.split('/');
    const path = join(this.root, FileStorage.keyFor(tenantId, hash));
    return this.encryption.decrypt(new Uint8Array(await readFile(path)), { tenantId });
  }
}
