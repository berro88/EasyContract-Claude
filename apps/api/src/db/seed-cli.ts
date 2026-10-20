import { loadConfig } from '../config.ts';
import { openDb } from './index.ts';
import { seed } from './seed.ts';

const config = loadConfig();
const db = openDb(config.dbPath);
seed(db);
console.log(`Seeded ${config.dbPath}`);
