import path from 'node:path';
import fs from 'node:fs';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
export const PORT = Number(process.env.PORT || 8787);
export const dirs = {
  projects: path.join(DATA, 'projects'),
  library: path.join(DATA, 'library'),
  cache: path.join(DATA, 'cache'),
};
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

/** The API key is only ever read here, on the backend. */
export function geminiKey() {
  return process.env.GEMINI_API_KEY || '';
}
