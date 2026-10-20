import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db/index.ts';
import { seed } from './db/seed.ts';
import { FileStorage, IdentityEncryption } from './lib/storage.ts';
import { DeterministicProvider } from './providers/deterministic.ts';

const config = loadConfig();
const db = openDb(config.dbPath);
seed(db);

const app = await buildApp(
  { db, config, storage: new FileStorage(config.storageDir, new IdentityEncryption()), ai: new DeterministicProvider() },
  { logger: true },
);
await app.listen({ port: config.port, host: '127.0.0.1' });
