import { join, resolve } from 'node:path';
import { UPLOAD_LIMITS } from '@easycontract/shared';

export interface Config {
  port: number;
  host: string;
  production: boolean;
  dataDir: string;
  dbPath: string;
  storageDir: string;
  maxUploadBytes: number;
  /** The x-user-id header shortcut. Never on in production. */
  devAuth: boolean;
  /** Cookies only over HTTPS. */
  secureCookies: boolean;
  /** When set, every request needs this password (HTTP Basic). Comes only from the environment. */
  previewPassword: string | null;
  /** Built web app to serve, if present. */
  webDistDir: string | null;
  ocrEnabled: boolean;
}

// Configuration comes from environment variables only; nothing secret lives in the repo.
export function loadConfig(env = process.env): Config {
  const dataDir = resolve(env.DATA_DIR ?? './data');
  const maxMb = Number(env.MAX_UPLOAD_MB);
  const production = env.NODE_ENV === 'production';
  return {
    port: Number(env.PORT ?? env.API_PORT ?? 3001),
    host: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    production,
    devAuth: !production && env.ALLOW_DEV_AUTH !== '0',
    secureCookies: production,
    previewPassword: env.PREVIEW_PASSWORD?.trim() || null,
    webDistDir: env.WEB_DIST_DIR ? resolve(env.WEB_DIST_DIR) : null,
    ocrEnabled: env.OCR_ENABLED === '1',
    dataDir,
    dbPath: join(dataDir, 'easycontract.sqlite'),
    storageDir: join(dataDir, 'storage'),
    maxUploadBytes: Number.isFinite(maxMb) && maxMb > 0 ? maxMb * 1024 * 1024 : UPLOAD_LIMITS.maxBytes,
  };
}
