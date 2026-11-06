import fs from 'node:fs';
import { generateContent, request, inlineParts, GeminiError } from './gemini.js';
import { resolveModel, markStatus } from './models.js';
import { assertAllowed } from './guard.js';

/**
 * PAID-CLASS generation (images / video). Every call passes through assertAllowed(), which refuses unless:
 * paid generation is enabled in settings, a price is configured, the estimate fits the daily ceiling, and the caller
 * passes confirmed=true for THIS call. On a free-tier key these models return quota 0 and the call fails with
 * `tier_blocked`; that is reported, never papered over.
 *
 * STATUS: implemented against the documented generateContent response shapes, but NOT verified end-to-end because
 * the key this was built with has quota 0 for every image/video model. Treat the first paid run as a test.
 */
export async function generateImage({ prompt, aspect = '1:1', outFile, confirmed = false }) {
  assertAllowed({ kind: 'image', model: null, units: 1, confirmed }); // fail fast, before any network call
  const { model } = await resolveModel('image');
  if (!model) throw new GeminiError('not_found', 'No image model is available for this key.');
  const g = assertAllowed({ kind: 'image', model, units: 1, confirmed });
  let resp;
  try {
    resp = await generateContent(model, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
    }, { kind: 'image', estUsd: g.estimate?.usd, maxTries: 2 });
  } catch (e) { if (e.kind === 'tier_blocked') markStatus(model, 'needs_billing', e.message); throw e; }
  const part = inlineParts(resp).find((p) => p.inlineData?.mimeType?.startsWith('image/'));
  if (!part) throw new GeminiError('empty', 'Image model returned no image.');
  fs.writeFileSync(outFile, Buffer.from(part.inlineData.data, 'base64'));
  return { file: outFile, model };
}

export async function generateVideo({ prompt, aspect = '9:16', seconds = 6, outFile, confirmed = false }) {
  assertAllowed({ kind: 'video', model: null, units: seconds, confirmed }); // fail fast, before any network call
  const { model } = await resolveModel('video');
  if (!model) throw new GeminiError('not_found', 'No video model is available for this key.');
  const g = assertAllowed({ kind: 'video', model, units: seconds, confirmed });
  let resp;
  try {
    resp = await generateContent(model, {
      contents: [{ parts: [{ text: `${prompt}\n\nAspect ratio ${aspect}. Duration about ${seconds} seconds. No on-screen text.` }] }],
    }, { kind: 'video', estUsd: g.estimate?.usd, maxTries: 1, timeoutMs: 600000 });
  } catch (e) { if (e.kind === 'tier_blocked') markStatus(model, 'needs_billing', e.message); throw e; }
  const part = inlineParts(resp).find((p) => p.inlineData?.mimeType?.startsWith('video/') || p.fileData?.mimeType?.startsWith('video/'));
  if (!part) throw new GeminiError('empty', 'Video model returned no video.');
  if (part.inlineData) fs.writeFileSync(outFile, Buffer.from(part.inlineData.data, 'base64'));
  else {
    const key = (await import('../config.js')).geminiKey();
    const r = await fetch(part.fileData.fileUri, { headers: { 'x-goog-api-key': key } });
    if (!r.ok) throw new GeminiError('server', `Could not download generated video (HTTP ${r.status}).`);
    fs.writeFileSync(outFile, Buffer.from(await r.arrayBuffer()));
  }
  return { file: outFile, model };
}

/** Minimal availability probe: lists nothing, spends nothing for free-class. Paid-class probes require confirmation. */
export async function probeModel(kind, { confirmed = false } = {}) {
  const { model } = await resolveModel(kind);
  if (!model) return { kind, model: null, status: 'unavailable', detail: 'Not in this key\'s model list.' };
  try {
    if (kind === 'text') await generateContent(model, { contents: [{ parts: [{ text: 'ok' }] }], generationConfig: { maxOutputTokens: 16 } }, { kind: 'text', maxTries: 1 });
    else if (kind === 'tts') await generateContent(model, { contents: [{ parts: [{ text: 'Hi.' }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } } }, { kind: 'tts', maxTries: 1 });
    else if (kind === 'image') { assertAllowed({ kind, model, units: 1, confirmed }); await generateContent(model, { contents: [{ parts: [{ text: 'a plain white square' }] }], generationConfig: { responseModalities: ['IMAGE'] } }, { kind: 'image', maxTries: 1 }); }
    else if (kind === 'video') { assertAllowed({ kind, model, units: 2, confirmed }); await generateContent(model, { contents: [{ parts: [{ text: 'a 1 second clip of a white screen' }] }] }, { kind: 'video', maxTries: 1, timeoutMs: 300000 }); }
    else return { kind, model, status: 'unverified', detail: 'No probe implemented for this kind.' };
    markStatus(model, kind === 'text' || kind === 'tts' ? 'free_ok' : 'paid_ok', 'probe succeeded');
    return { kind, model, status: 'ok' };
  } catch (e) {
    if (e.kind === 'tier_blocked') markStatus(model, 'needs_billing', e.message);
    return { kind, model, status: e.kind, detail: e.message, estimate: e.estimate };
  }
}
