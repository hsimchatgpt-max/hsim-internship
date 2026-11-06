import path from 'node:path';
import { DATA } from '../config.js';
import { readJson, writeJson } from './util.js';

const FILE = path.join(DATA, 'settings.json');

export const DEFAULT_SETTINGS = {
  // NEVER spend on paid-class generation (image/video/music) unless this is true AND each call is confirmed.
  allowPaid: false,
  requireScriptApproval: true,
  // Daily request caps enforced locally, before Google's own limits are hit.
  limits: { text: 150, tts: 40, image: 10, video: 5, music: 5 },
  // Optional hard ceiling for paid generation per day, in estimated USD. 0 = none allowed.
  maxPaidUsdPerDay: 0,
  // Optional preferred model overrides (kind -> model id). Empty = auto-pick from the live model list.
  modelOverrides: {},
  grounding: false, // Google Search grounding for the Research agent (may be billed separately)
};

export function getSettings() {
  const s = readJson(FILE, {});
  return { ...DEFAULT_SETTINGS, ...s, limits: { ...DEFAULT_SETTINGS.limits, ...(s.limits || {}) } };
}
export function saveSettings(patch) {
  const cur = getSettings();
  const next = { ...cur, ...patch, limits: { ...cur.limits, ...(patch.limits || {}) } };
  next.allowPaid = !!next.allowPaid;
  for (const k of Object.keys(next.limits)) next.limits[k] = Math.max(0, Math.floor(Number(next.limits[k]) || 0));
  next.maxPaidUsdPerDay = Math.max(0, Number(next.maxPaidUsdPerDay) || 0);
  writeJson(FILE, next);
  return next;
}
