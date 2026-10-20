import { join, resolve } from 'node:path';
import { UPLOAD_LIMITS } from '@easycontract/shared';

export interface Config {
  port: number;
  dataDir: string;
  dbPath: string;
  storageDir: string;
  maxUploadBytes: number;
}

// Configuration comes from environment variables only; nothing secret lives in the repo.
export function loadConfig(env = process.env): Config {
  const dataDir = resolve(env.DATA_DIR ?? './data');
  const maxMb = Number(env.MAX_UPLOAD_MB);
  return {
    port: Number(env.API_PORT ?? 3001),
    dataDir,
    dbPath: join(dataDir, 'easycontract.sqlite'),
    storageDir: join(dataDir, 'storage'),
    maxUploadBytes: Number.isFinite(maxMb) && maxMb > 0 ? maxMb * 1024 * 1024 : UPLOAD_LIMITS.maxBytes,
  };
}
