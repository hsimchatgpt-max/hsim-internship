import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Isolated data dir per test process. Must be set BEFORE importing app modules.
export const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aistudio-test-'));
process.env.DATA_DIR = TMP;
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key-not-real';
export const ROOT = path.resolve(import.meta.dirname, '../..');
export const PRESET = path.join(ROOT, 'server/assets/avatars/ananya.png');
