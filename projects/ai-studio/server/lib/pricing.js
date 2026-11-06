import path from 'node:path';
import { DATA } from '../config.js';
import { readJson, writeJson } from './util.js';

const FILE = path.join(DATA, 'pricing.json');

/**
 * Rate card. Google's prices change and are NOT returned by the API, so this app ships with NO invented
 * prices: every paid-class rate starts as null. Enter the current numbers from ai.google.dev/pricing in
 * API Settings. Until a rate is set, paid generation of that kind is refused (the estimate would be meaningless).
 */
export const DEFAULT_RATES = {
  image: { unit: 'per image', usd: null },
  video: { unit: 'per second of video', usd: null },
  music: { unit: 'per clip', usd: null },
};

export const getRates = () => ({ ...DEFAULT_RATES, ...readJson(FILE, {}) });
export function saveRates(patch) {
  const cur = getRates();
  for (const [k, v] of Object.entries(patch || {})) {
    if (!cur[k]) continue;
    cur[k] = { ...cur[k], usd: v?.usd === null || v?.usd === '' || v?.usd === undefined ? null : Math.max(0, Number(v.usd)) };
  }
  writeJson(FILE, cur);
  return cur;
}

/** units: count of images / seconds of video / clips. Returns {units, usd|null, unit, priced}. */
export function estimate(kind, units) {
  const r = getRates()[kind];
  if (!r) return { kind, units, usd: 0, unit: 'free-tier class', priced: true };
  const priced = r.usd !== null && r.usd !== undefined;
  return { kind, units, unit: r.unit, rate: r.usd, priced, usd: priced ? +(units * r.usd).toFixed(4) : null };
}
