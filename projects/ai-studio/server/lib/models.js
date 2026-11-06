import path from 'node:path';
import { DATA } from '../config.js';
import { readJson, writeJson } from './util.js';
import { listModels } from './gemini.js';
import { getSettings } from './settings.js';

const STATUS_FILE = path.join(DATA, 'model-status.json');

/** Preference order per capability. The first one present in the live model list (and not known-blocked) wins. */
export const PREFS = {
  text: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'],
  tts: ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'],
  image: ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image', 'gemini-3-pro-image'],
  video: ['gemini-omni-1.1-flash', 'gemini-omni-flash-preview', 'gemini-omni-1.2-flash'],
  music: ['lyria-3-clip-preview', 'lyria-3.5'],
};

/** Capabilities whose generation is treated as PAID-class: never run without allowPaid + per-call confirmation. */
export const PAID_KINDS = new Set(['image', 'video', 'music']);

let cache = { at: 0, models: null };
export async function getModelList(force = false) {
  if (!force && cache.models && Date.now() - cache.at < 5 * 60_000) return cache.models;
  const models = await listModels();
  cache = { at: Date.now(), models: models.map((m) => ({ id: m.name.replace(/^models\//, ''), displayName: m.displayName, methods: m.supportedGenerationMethods || [], inputTokenLimit: m.inputTokenLimit, outputTokenLimit: m.outputTokenLimit })) };
  return cache.models;
}

export const loadStatus = () => readJson(STATUS_FILE, {});
export function markStatus(model, status, detail, untilMs) {
  const s = loadStatus();
  s[model] = { status, detail, checkedAt: new Date().toISOString(), ...(untilMs ? { until: new Date(Date.now() + untilMs).toISOString() } : {}) }; // free_ok | needs_billing | paid_ok | quota_exhausted
  writeJson(STATUS_FILE, s);
}

/** Resolve which model to use for a capability, from the *actual* list for this key. */
export async function resolveModel(kind) {
  const list = await getModelList();
  const ids = new Set(list.filter((m) => m.methods.includes('generateContent')).map((m) => m.id));
  const override = getSettings().modelOverrides?.[kind];
  const candidates = override ? [override, ...PREFS[kind]] : PREFS[kind];
  const st = loadStatus();
  const usable = candidates.filter((id) => ids.has(id));
  const isBlocked = (id) => st[id]?.status === 'needs_billing' || (['quota_exhausted', 'unavailable'].includes(st[id]?.status) && st[id].until && new Date(st[id].until) > new Date());
  const notBlocked = usable.find((id) => !isBlocked(id));
  const model = notBlocked || usable[0] || null;
  return { model, available: usable, blocked: usable.filter(isBlocked) };
}

export async function capabilityReport() {
  const out = {};
  const st = loadStatus();
  for (const kind of Object.keys(PREFS)) {
    const r = await resolveModel(kind);
    out[kind] = { ...r, paidClass: PAID_KINDS.has(kind), status: r.model ? st[r.model] || { status: 'unverified' } : null };
  }
  return out;
}
