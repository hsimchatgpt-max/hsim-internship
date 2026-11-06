import path from 'node:path';
import { DATA } from '../config.js';
import { readJson, writeJson, today } from './util.js';

const FILE = path.join(DATA, 'usage.json');
const load = () => readJson(FILE, { days: {}, events: [] });

/** Local usage ledger. Google does not expose remaining quota to API keys, so we count what *we* send. */
export function record({ model, kind, ok, status, usage, errorKind, estUsd }) {
  const l = load();
  const d = (l.days[today()] ||= { kinds: {}, models: {}, estPaidUsd: 0 });
  const k = (d.kinds[kind] ||= { requests: 0, errors: 0 });
  const m = (d.models[model] ||= { requests: 0, errors: 0, promptTokens: 0, outputTokens: 0 });
  k.requests++; m.requests++;
  if (!ok) { k.errors++; m.errors++; }
  m.promptTokens += usage?.promptTokenCount || 0;
  m.outputTokens += (usage?.candidatesTokenCount || 0) + (usage?.thoughtsTokenCount || 0);
  if (ok && estUsd) d.estPaidUsd += estUsd;
  l.events.push({ ts: new Date().toISOString(), model, kind, ok, status, errorKind, tokens: usage?.totalTokenCount });
  l.events = l.events.slice(-300);
  const keep = Object.keys(l.days).sort().slice(-30);
  for (const day of Object.keys(l.days)) if (!keep.includes(day)) delete l.days[day];
  writeJson(FILE, l);
}

export const usageToday = () => load().days[today()] || { kinds: {}, models: {}, estPaidUsd: 0 };
export const usageAll = () => load();
