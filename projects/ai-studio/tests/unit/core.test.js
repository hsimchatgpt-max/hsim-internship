import './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, GeminiError } from '../../server/lib/gemini.js';
import { assertAllowed } from '../../server/lib/guard.js';
import { saveSettings } from '../../server/lib/settings.js';
import { saveRates, estimate } from '../../server/lib/pricing.js';
import { record } from '../../server/lib/ledger.js';
import { pcmToWav, buildSpeechPrompt } from '../../server/lib/tts.js';
import { estimateWordTimings, buildAss } from '../../server/video/captions.js';
import { redact } from '../../server/lib/util.js';
import fs from 'node:fs';
import path from 'node:path';
import { TMP } from './helpers.js';

test('error classification: tier-blocked vs daily vs per-minute vs auth', () => {
  const body = (msg, details = []) => ({ error: { message: msg, details } });
  assert.equal(classify(429, body('Quota exceeded ... limit: 0, model: x')).kind, 'tier_blocked');
  assert.equal(classify(429, body('Quota exceeded limit: 20 ... requests per day limit exceeded')).kind, 'quota_daily');
  const rl = classify(429, body('slow down', [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34.5s' }]));
  assert.equal(rl.kind, 'rate_limit'); assert.equal(rl.retryAfterMs, 34500);
  assert.equal(classify(400, body('API key not valid')).kind, 'auth');
  assert.equal(classify(503, body('overloaded')).kind, 'server');
});

test('API keys are redacted from error text', () => {
  assert.ok(!redact('failed https://x?key=AIzaSyA1234567890123456789012345 and AQ.FAKEFAKEFAKEFAKEFAKEFAKEFAKE00').match(/AIza|AQ\./));
  assert.ok(!new GeminiError('auth', 'bad key AQ.FAKEFAKEFAKEFAKEFAKEFAKEFAKE00').message.includes('AQ.FAKE'));
});

test('guard: paid-class generation is refused by default, then step by step', () => {
  // 1. disabled by default
  assert.throws(() => assertAllowed({ kind: 'image', model: 'm', units: 1, confirmed: true }), (e) => e.kind === 'confirmation_required' && /disabled/.test(e.message));
  // 2. enabled but no price configured -> estimate meaningless -> refuse
  saveSettings({ allowPaid: true, limits: { image: 10 }, maxPaidUsdPerDay: 5 });
  assert.throws(() => assertAllowed({ kind: 'image', model: 'm', units: 1, confirmed: true }), (e) => /price/.test(e.message));
  // 3. priced but not confirmed for THIS call
  saveRates({ image: { usd: 0.04 } });
  assert.throws(() => assertAllowed({ kind: 'image', model: 'm', units: 1 }), (e) => e.kind === 'confirmation_required' && e.estimate.usd === 0.04);
  // 4. exceeds daily ceiling
  assert.throws(() => assertAllowed({ kind: 'image', model: 'm', units: 200, confirmed: true }), (e) => e.kind === 'limit_reached');
  // 5. all conditions met
  assert.equal(assertAllowed({ kind: 'image', model: 'm', units: 2, confirmed: true }).paid, true);
});

test('guard: video limit of 0 blocks, text cap enforced from the usage ledger', () => {
  saveSettings({ allowPaid: true, limits: { video: 0, text: 2 }, maxPaidUsdPerDay: 50 }); saveRates({ video: { usd: 0.1 } });
  assert.throws(() => assertAllowed({ kind: 'video', model: 'm', units: 5, confirmed: true }), (e) => e.kind === 'limit_reached');
  record({ model: 'm', kind: 'text', ok: true, status: 200 }); record({ model: 'm', kind: 'text', ok: true, status: 200 });
  assert.throws(() => assertAllowed({ kind: 'text', model: 'm' }), (e) => e.kind === 'limit_reached');
});

test('pricing: shipped rate card has no invented prices', () => {
  fs.rmSync(path.join(TMP, 'pricing.json'), { force: true });
  assert.equal(estimate('video', 10).usd, null);
  assert.equal(estimate('video', 10).priced, false);
});

test('tts helpers', () => {
  const w = pcmToWav(Buffer.alloc(48000), 24000);
  assert.equal(w.toString('ascii', 0, 4), 'RIFF'); assert.equal(w.readUInt32LE(24), 24000); assert.equal(w.length, 44 + 48000);
  const p = buildSpeechPrompt({ text: 'Namaste dosto', language: 'hinglish', tone: 'warm' });
  assert.match(p, /Roman letters|Roman script|Roman/); assert.match(p, /TRANSCRIPT:\nNamaste dosto$/);
});

test('caption timings cover the speech window and highlight in order', () => {
  const t = estimateWordTimings('Aaj hum seekhenge, ki business kaise grow karein', 0.15, 5.15);
  assert.equal(t.length, 8); assert.ok(Math.abs(t[0].start - 0.15) < 1e-9); assert.ok(Math.abs(t.at(-1).end - 5.15) < 1e-9);
  assert.ok(t.every((x, i) => i === 0 || Math.abs(x.start - t[i - 1].end) < 1e-9));
});

test('captions use the Devanagari font for Hindi text and Latin font otherwise', () => {
  const f = path.join(TMP, 'a.ass');
  buildAss({ file: f, width: 540, height: 960, narration: 'नमस्ते दोस्तों', headline: 'हिंदी', speechEnd: 3, sceneDuration: 3.5 });
  assert.match(fs.readFileSync(f, 'utf8'), /Style: Cap,Noto Sans Devanagari/);
  buildAss({ file: f, width: 540, height: 960, narration: 'Hello world', speechEnd: 3, sceneDuration: 3.5 });
  assert.match(fs.readFileSync(f, 'utf8'), /Style: Cap,Noto Sans,/);
});
