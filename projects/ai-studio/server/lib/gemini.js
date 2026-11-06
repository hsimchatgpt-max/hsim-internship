import { geminiKey } from '../config.js';
import { sleep, redact } from './util.js';
import { record } from './ledger.js';

export const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  constructor(kind, message, extra = {}) {
    super(redact(message));
    this.name = 'GeminiError';
    this.kind = kind; // auth|tier_blocked|quota_daily|rate_limit|bad_request|not_found|server|network|confirmation_required|limit_reached|blocked_content|empty
    Object.assign(this, extra);
  }
}

function parseRetryDelay(body) {
  const d = body?.error?.details?.find((x) => String(x['@type']).includes('RetryInfo'));
  const m = /([\d.]+)s/.exec(d?.retryDelay || '');
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

export function classify(status, body) {
  const msg = body?.error?.message || `HTTP ${status}`;
  const raw = JSON.stringify(body?.error || {});
  const retryAfterMs = parseRetryDelay(body);
  if (status === 401 || status === 403 || /API key (not valid|expired)|API_KEY_INVALID|PERMISSION_DENIED/i.test(raw))
    return new GeminiError('auth', msg, { status });
  if (status === 429) {
    if (/limit: 0/.test(msg)) return new GeminiError('tier_blocked', 'This model has a quota of 0 on your current plan (free tier does not include it). Enable billing in Google AI Studio to use it.', { status });
    if (/PerDay|per day/i.test(raw + msg)) return new GeminiError('quota_daily', msg, { status, retryAfterMs });
    return new GeminiError('rate_limit', msg, { status, retryAfterMs });
  }
  if (status === 404) return new GeminiError('not_found', msg, { status });
  if (status === 400) return new GeminiError('bad_request', msg, { status });
  if (status >= 500) return new GeminiError('server', msg, { status });
  return new GeminiError('bad_request', msg, { status });
}

const RETRYABLE = new Set(['rate_limit', 'server', 'network']);

/**
 * Low-level request with timeout + retry (exponential backoff, honours Google's retryDelay).
 * `kind` is used for usage accounting only; policy checks live in guard.js and are applied by callers.
 */
export async function request(method, pathOrUrl, { body, kind = 'other', model = '-', maxTries = 4, timeoutMs = 180000, estUsd } = {}) {
  const key = geminiKey();
  if (!key) throw new GeminiError('auth', 'GEMINI_API_KEY is not configured on the server.');
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}/${pathOrUrl}`;
  let last;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = null; }
      if (res.ok) {
        record({ model, kind, ok: true, status: res.status, usage: json?.usageMetadata, estUsd });
        return json;
      }
      last = classify(res.status, json || { error: { message: text.slice(0, 300) } });
    } catch (e) {
      last = e instanceof GeminiError ? e : new GeminiError('network', `Network error: ${e.name === 'TimeoutError' ? 'request timed out' : e.message}`);
    }
    record({ model, kind, ok: false, status: last.status, errorKind: last.kind });
    if (!RETRYABLE.has(last.kind) || attempt === maxTries) break;
    const wait = last.retryAfterMs ?? Math.min(2 ** attempt * 1000, 30000);
    if (wait > 90000) break; // not worth blocking a request this long; surface it to the user
    await sleep(wait + Math.random() * 400);
  }
  throw last;
}

export const generateContent = (model, body, opts = {}) =>
  request('POST', `models/${model}:generateContent`, { ...opts, body, model });

export const listModels = async () => {
  const out = [];
  let pageToken = '';
  do {
    const j = await request('GET', `models?pageSize=200${pageToken ? '&pageToken=' + pageToken : ''}`, { kind: 'meta', model: 'models.list', maxTries: 2, timeoutMs: 30000 });
    out.push(...(j.models || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
};

export function textOf(resp) {
  const c = resp?.candidates?.[0];
  if (!c) {
    const br = resp?.promptFeedback?.blockReason;
    throw new GeminiError(br ? 'blocked_content' : 'empty', br ? `Prompt blocked: ${br}` : 'Model returned no candidates');
  }
  return (c.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
}

export function jsonOf(resp) {
  const t = textOf(resp).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(t); } catch (e) { throw new GeminiError('bad_request', 'Model returned invalid JSON: ' + t.slice(0, 160)); }
}

export function inlineParts(resp) {
  return (resp?.candidates?.[0]?.content?.parts || []).filter((p) => p.inlineData || p.fileData);
}
