import { generateContent, jsonOf, GeminiError } from '../lib/gemini.js';
import { resolveModel, markStatus } from '../lib/models.js';
import { assertAllowed } from '../lib/guard.js';

export const S = {
  str: (description) => ({ type: 'STRING', description }),
  num: (description) => ({ type: 'NUMBER', description }),
  bool: (description) => ({ type: 'BOOLEAN', description }),
  enum: (values, description) => ({ type: 'STRING', enum: values, description }),
  arr: (items, description) => ({ type: 'ARRAY', items, description }),
  obj: (properties, description) => ({ type: 'OBJECT', properties, required: Object.keys(properties), description }),
};

/**
 * Every agent is one Gemini call with a system prompt and a JSON schema.
 * Returns { data, agent, model, tokens } so the project can record which agent produced what.
 */
export async function callAgent({ agent, system, user, schema, parts = [], temperature = 0.8, tools }) {
  const { available, blocked } = await resolveModel('text');
  const candidates = available.filter((m) => !blocked.includes(m));
  if (!candidates.length) throw new GeminiError('not_found', 'No Gemini text model is available for this API key.');
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [...parts, { text: user }] }],
    generationConfig: { temperature, ...(schema && !tools ? { responseMimeType: 'application/json', responseSchema: schema } : {}) },
    ...(tools ? { tools } : {}),
  };
  // Try the preferred model first; on overload/unavailability fall back to the next TEXT model (all free-class). Never to a paid-class model.
  let lastErr;
  for (const model of candidates.slice(0, 6)) {
    assertAllowed({ kind: 'text', model });
    try {
      const resp = await generateContent(model, body, { kind: 'text', maxTries: lastErr ? 2 : 3 });
      return { data: jsonOf(resp), agent, model, tokens: resp.usageMetadata?.totalTokenCount, raw: resp };
    } catch (e) {
      lastErr = e;
      if (!['server', 'tier_blocked', 'not_found', 'rate_limit', 'quota_daily'].includes(e.kind) && !/no longer available/i.test(e.message) && !(e.kind === 'bad_request' && /JSON/.test(e.message))) throw e;
      if (e.kind === 'tier_blocked') markStatus(model, 'needs_billing', e.message);
      if (e.kind === 'not_found' || /no longer available/i.test(e.message)) markStatus(model, 'unavailable', e.message.slice(0, 160), 7 * 24 * 3600e3);
      if (e.kind === 'quota_daily') markStatus(model, 'quota_exhausted', 'Daily free-tier quota used up', Math.min(e.retryAfterMs || 6 * 3600e3, 24 * 3600e3));
    }
  }
  throw lastErr;
}

export const brandBrief = (b) => !b ? 'No brand profile set.' :
  `BRAND PROFILE\nName: ${b.name}\nIndustry: ${b.industry || '-'}\nAudience: ${b.audience || '-'}\nVoice/tone: ${b.voice || '-'}\nColors: ${b.colors?.primary || '-'} / ${b.colors?.secondary || '-'} / accent ${b.colors?.accent || '-'}\nTagline: ${b.tagline || '-'}\nAlways: ${b.dos || '-'}\nNever: ${b.donts || '-'}`;

export const LANG_RULE = (code) => code === 'hinglish'
  ? 'Write narration in natural Hinglish: Hindi written in ROMAN letters mixed with common English words (e.g. "Aaj hum seekhenge ki..."). Never use Devanagari.'
  : code === 'hi-IN' ? 'Write narration in Hindi using Devanagari script.'
  : `Write narration in the language with BCP-47 code ${code}.`;
