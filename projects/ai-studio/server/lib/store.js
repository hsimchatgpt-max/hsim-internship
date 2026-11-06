import fs from 'node:fs';
import path from 'node:path';
import { DATA, dirs } from '../config.js';
import { readJson, writeJson, uid } from './util.js';

const LIB_INDEX = path.join(dirs.library, 'index.json');
const BRAND_FILE = path.join(DATA, 'brand.json');

// ---------- Brand profile ----------
export const DEFAULT_BRAND = { name: '', industry: '', audience: '', voice: '', tagline: '', dos: '', donts: '', colors: { primary: '#1f7a3d', secondary: '#0b3d2e', accent: '#ff9f1c' }, logoAssetId: null };
export const getBrand = () => ({ ...DEFAULT_BRAND, ...readJson(BRAND_FILE, {}), colors: { ...DEFAULT_BRAND.colors, ...(readJson(BRAND_FILE, {}).colors || {}) } });
export const saveBrand = (b) => { const cur = getBrand(); const next = { ...cur, ...b, colors: { ...cur.colors, ...(b.colors || {}) } }; writeJson(BRAND_FILE, next); return next; };

// ---------- Library ----------
const loadLib = () => readJson(LIB_INDEX, { items: [] });
export const listLibrary = (filter = {}) => loadLib().items.filter((i) => Object.entries(filter).every(([k, v]) => i[k] === v));
export const getAsset = (id) => loadLib().items.find((i) => i.id === id) || null;
export const assetPath = (a) => path.join(dirs.library, a.file);

/** Add a file to the library. `copy` stores a copy; originals (kind photo-original) are made read-only and never rewritten. */
export function addAsset({ kind, name, srcFile, buffer, ext, mime, projectId, sourceId, meta = {}, readonly = false }) {
  const id = uid('a_');
  const fileName = `${kind}${ext || path.extname(srcFile || '') || ''}`;
  const rel = path.join(id, fileName);
  const abs = path.join(dirs.library, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (buffer) fs.writeFileSync(abs, buffer); else fs.copyFileSync(srcFile, abs);
  if (readonly) fs.chmodSync(abs, 0o444);
  const item = { id, kind, name: name || fileName, file: rel, mime, projectId: projectId || null, sourceId: sourceId || null, meta, createdAt: new Date().toISOString() };
  const lib = loadLib(); lib.items.push(item); writeJson(LIB_INDEX, lib);
  return item;
}
export function deleteAsset(id) {
  const lib = loadLib(); const a = lib.items.find((i) => i.id === id);
  if (!a) return false;
  lib.items = lib.items.filter((i) => i.id !== id); writeJson(LIB_INDEX, lib);
  fs.rmSync(path.join(dirs.library, id), { recursive: true, force: true });
  return true;
}
export function updateAssetMeta(id, meta) {
  const lib = loadLib(); const a = lib.items.find((i) => i.id === id); if (!a) return null;
  a.meta = { ...a.meta, ...meta }; writeJson(LIB_INDEX, lib); return a;
}

// ---------- Projects ----------
export const projectDir = (id) => path.join(dirs.projects, id);
const pfile = (id) => path.join(projectDir(id), 'project.json');
export const validId = (id) => /^p_[0-9a-f]{10}$/.test(id);

export function createProject(data) {
  const id = uid('p_');
  const p = { id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'draft', steps: {}, agentLog: [], revisions: [], ...data };
  fs.mkdirSync(path.join(projectDir(id), 'files'), { recursive: true });
  writeJson(pfile(id), p);
  return p;
}
export const getProject = (id) => (validId(id) ? readJson(pfile(id), null) : null);
export function saveProject(p) { p.updatedAt = new Date().toISOString(); writeJson(pfile(p.id), p); return p; }
export function listProjects() {
  if (!fs.existsSync(dirs.projects)) return [];
  return fs.readdirSync(dirs.projects).filter(validId).map((id) => getProject(id)).filter(Boolean)
    .map((p) => ({ id: p.id, title: p.script?.title || p.copy?.headline || p.command?.slice(0, 60), command: p.command, status: p.status, contentType: p.brief?.contentType, createdAt: p.createdAt, updatedAt: p.updatedAt, hasOutput: !!p.assets?.final }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function deleteProject(id) { if (!validId(id)) return false; fs.rmSync(projectDir(id), { recursive: true, force: true }); return true; }
