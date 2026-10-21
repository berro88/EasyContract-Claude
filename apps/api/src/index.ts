import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db/index.ts';
import { seed } from './db/seed.ts';
import { FileStorage, IdentityEncryption } from './lib/storage.ts';
import { DeterministicProvider } from './providers/deterministic.ts';
import { DbPlaybookSource } from './library/store.ts';
import { TesseractCliOcr } from './ocr/tesseract.ts';

const config = loadConfig();
const db = openDb(config.dbPath);
// Demo companies and the dev users are for local development only.
if (!config.production) seed(db);

// Local OCR is optional: switched on with OCR_ENABLED=1 and only if the tools are installed.
const ocr = config.ocrEnabled && (await TesseractCliOcr.available()) ? new TesseractCliOcr() : null;

const app = await buildApp(
  { db, config, storage: new FileStorage(config.storageDir, new IdentityEncryption()), ai: new DeterministicProvider(), playbooks: new DbPlaybookSource(db), ocr },
  { logger: true },
);
if (config.ocrEnabled && !ocr) app.log.warn('OCR_ENABLED is set but tesseract or pdftoppm is not installed; scans will be reported as unreadable.');
if (config.openAccess) app.log.warn('OPEN_ACCESS is on: no sign-in is needed and every visitor shares one company. Remove OPEN_ACCESS to restore sign-in.');
if (config.devAuth) app.log.warn('Development sign-in (x-user-id header) is on. It is always off when NODE_ENV=production.');
await app.listen({ port: config.port, host: config.host });
