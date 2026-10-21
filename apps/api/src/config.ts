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
  /** When set, creating a new company account needs this code. Invited people never need it. */
  signupCode: string | null;
  /** Lets anyone create an account without a code. Off by default in production. */
  openSignup: boolean;
  /**
   * Temporary: no sign-in at all. Every visitor without a session uses one
   * shared "Open preview" company. Only for trying the app; never for real data.
   */
  openAccess: boolean;
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
    signupCode: env.SIGNUP_CODE?.trim() || null,
    openSignup: env.ALLOW_OPEN_SIGNUP === '1' || !production,
    openAccess: env.OPEN_ACCESS === '1',
    webDistDir: env.WEB_DIST_DIR ? resolve(env.WEB_DIST_DIR) : null,
    ocrEnabled: env.OCR_ENABLED === '1',
    dataDir,
    dbPath: join(dataDir, 'easycontract.sqlite'),
    storageDir: join(dataDir, 'storage'),
    maxUploadBytes: Number.isFinite(maxMb) && maxMb > 0 ? maxMb * 1024 * 1024 : UPLOAD_LIMITS.maxBytes,
  };
}
