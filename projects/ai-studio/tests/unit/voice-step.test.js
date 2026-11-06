import { TMP } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg } from '../../server/lib/util.js';
import { STEPS, mergeOptions } from '../../server/workflow/pipeline.js';
import { createProject, getProject, saveProject, projectDir } from '../../server/lib/store.js';

// Fake ONLY the network edge (fetch) with canned Gemini-shaped responses. Everything else is the real code path.
let ttsCalls = [], wavB64;
test.before(async () => {
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=300:duration=1.5', '-ar', '24000', '-ac', '1', path.join(TMP, 't.wav')]);
  wavB64 = fs.readFileSync(path.join(TMP, 't.wav')).toString('base64');
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/models?')) return new Response(JSON.stringify({ models: ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.8-flash'].map((n) => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) }), { status: 200 });
    if (u.includes(':generateContent') && u.includes('tts')) {
      const body = JSON.parse(init.body); ttsCalls.push({ model: /models\/([^:]+):/.exec(u)[1], voice: body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, text: body.contents[0].parts[0].text });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wavB64 } }] } }], usageMetadata: { totalTokenCount: 10 } }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
});

const mk = () => createProject({ command: 'x', options: mergeOptions({}, { voice: { voice: 'Sulafat', speed: 1 } }), brief: { contentType: 'video', language: 'hinglish', tone: 'warm' }, steps: {}, agentLog: [], assets: { scenes: {} },
  script: { title: 't', scenes: [1, 2, 3].map((i) => ({ id: 's' + i, narration: 'Scene number ' + i, kind: 'visual', onScreenText: '' })) } });
const mtimes = (p) => ['s1', 's2', 's3'].map((s) => fs.statSync(path.join(projectDir(p.id), 'files/audio', s + '.wav')).mtimeMs);

test('voice step: one voice + one pinned model for all scenes; unchanged scenes are NOT re-voiced; one edit costs exactly one call', async () => {
  const p0 = mk(); ttsCalls = [];
  await STEPS.voice(getProject(p0.id)); const p1 = getProject(p0.id);
  assert.equal(ttsCalls.length, 3);
  assert.equal(new Set(ttsCalls.map((c) => c.voice)).size, 1, 'same voice for every scene');
  assert.equal(new Set(ttsCalls.map((c) => c.model)).size, 1, 'same model for every scene');
  assert.match(ttsCalls[0].text, /Hinglish/i);
  assert.ok(fs.existsSync(path.join(projectDir(p0.id), 'files/voiceover.mp3')), 'combined voice-over produced');

  ttsCalls = []; await STEPS.voice(getProject(p0.id)); // nothing changed
  assert.equal(ttsCalls.length, 0);

  const before = mtimes(p0); await new Promise((r) => setTimeout(r, 30));
  const p2 = getProject(p0.id); p2.script.scenes[1].narration = 'Scene two, rewritten'; saveProject(p2);
  ttsCalls = []; await STEPS.voice(getProject(p0.id));
  assert.equal(ttsCalls.length, 1); assert.match(ttsCalls[0].text, /rewritten/);
  const after = mtimes(p0);
  assert.equal(after[0], before[0]); assert.notEqual(after[1], before[1]); assert.equal(after[2], before[2]);
  assert.equal(ttsCalls[0].model, p1.voiceLock.model, 'edit reuses the pinned model');
});

test('changing the voice re-voices every scene (consistency), unknown voices are rejected before any call', async () => {
  const p = mk(); await STEPS.voice(getProject(p.id));
  const q = getProject(p.id); q.options.voice.voice = 'Puck'; q.voiceLock = null; saveProject(q);
  ttsCalls = []; await STEPS.voice(getProject(p.id));
  assert.equal(ttsCalls.length, 3); assert.ok(ttsCalls.every((c) => c.voice === 'Puck'));
  const r = getProject(p.id); r.options.voice.voice = 'NotAVoice'; r.voiceLock = null; saveProject(r); ttsCalls = [];
  await assert.rejects(STEPS.voice(getProject(p.id)), /Unknown voice/); assert.equal(ttsCalls.length, 0);
});
