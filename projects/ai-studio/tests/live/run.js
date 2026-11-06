// Live integration checks against the REAL Gemini API (uses your key and a few free-tier requests).
//   npm run test:live            -> free-class checks only (list models, text agent, TTS + round-trip transcription)
//   npm run test:live -- --paid  -> ALSO probes image/video models (may cost money on a billed plan)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getModelList, resolveModel, capabilityReport } from '../../server/lib/models.js';
import { generateContent, textOf, GeminiError } from '../../server/lib/gemini.js';
import { synthesize } from '../../server/lib/tts.js';
import { understandCommand } from '../../server/agents/agents.js';
import { probeModel } from '../../server/lib/mediagen.js';
import { probe } from '../../server/lib/util.js';

const results = []; const rec = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const step = async (name, fn) => { try { rec(name, true, await fn()); } catch (e) { rec(name, false, `${e.kind || e.name}: ${e.message.slice(0, 200)}`); } };

await step('list models', async () => `${(await getModelList(true)).length} models`);
await step('capability resolution', async () => { const c = await capabilityReport(); return Object.entries(c).map(([k, v]) => `${k}=${v.model}`).join(', '); });
await step('Command Understanding agent returns valid structured JSON', async () => {
  const r = await understandCommand('Make a 20 second Hindi reel about tea');
  if (!['video', 'image'].includes(r.data.contentType) || !r.data.aspect) throw new Error('bad shape: ' + JSON.stringify(r.data));
  return `${r.model}: ${r.data.contentType} ${r.data.aspect} ${r.data.language}`;
});
await step('TTS returns real audio, and it speaks the transcript (not the instructions)', async () => {
  const out = path.join(os.tmpdir(), 'live-tts.wav');
  const r = await synthesize({ text: 'Welcome to our store. Fresh vegetables, delivered daily.', voice: 'Kore', language: 'en-US', tone: 'warm', outFile: out });
  const info = await probe(out); if (!info.hasAudio || info.duration < 2) throw new Error('audio too short: ' + info.duration);
  const { model } = await resolveModel('text');
  const t = await generateContent(model, { contents: [{ parts: [{ inlineData: { mimeType: 'audio/wav', data: fs.readFileSync(out).toString('base64') } }, { text: 'Transcribe verbatim. Output only the transcript.' }] }] }, { kind: 'text' });
  const said = textOf(t).toLowerCase();
  if (!said.includes('fresh vegetables')) throw new Error('transcript mismatch: ' + said);
  if (/read the transcript|instructions/.test(said)) throw new Error('instructions were spoken aloud');
  return `${r.model}, ${info.duration.toFixed(1)}s, transcript OK`;
});
if (process.argv.includes('--paid')) {
  for (const kind of ['image', 'video']) await step(`${kind} model probe (PAID-class; confirmed by --paid)`, async () => { const r = await probeModel(kind, { confirmed: true }); if (r.status !== 'ok') throw new GeminiError(r.status, `${r.model}: ${r.detail || r.status}`); return r.model; });
} else console.log('SKIP  image/video probes (run with --paid to include; they are paid-class)');
const failed = results.filter((r) => !r.ok).length; console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
