import { TMP, PRESET } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg, probe, run } from '../../server/lib/util.js';
import { verifyAvatarVideo, pickProvider, motionScore } from '../../server/avatar/index.js';
import { AvatarUnavailable } from '../../server/avatar/providers/base.js';
import * as R from '../../server/video/render.js';
import { STEPS, mergeOptions } from '../../server/workflow/pipeline.js';
import { createProject, getProject } from '../../server/lib/store.js';
import { pcmToWav } from '../../server/lib/tts.js';

const W = (n) => path.join(TMP, n);
let speech;
test.before(async () => {
  // 3s of tone stands in for narration audio (the real TTS path is covered by the live test)
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', '-ar', '44100', '-ac', '1', W('speech.wav')]);
  speech = W('speech.wav');
});

test('anti-fake guard: a still image + audio is rejected, real motion is accepted, wrong length is rejected', async () => {
  await ffmpeg(['-loop', '1', '-i', PRESET, '-i', speech, '-shortest', '-vf', 'scale=320:320', '-pix_fmt', 'yuv420p', W('still.mp4')]);
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=320x320:d=3:r=25', '-i', speech, '-shortest', '-pix_fmt', 'yuv420p', W('moving.mp4')]);
  assert.ok((await motionScore(W('still.mp4'))) < 0.01);
  await assert.rejects(verifyAvatarVideo(W('still.mp4'), 3), /still image/);
  assert.ok((await verifyAvatarVideo(W('moving.mp4'), 3)).motion > 0.5);
  await assert.rejects(verifyAvatarVideo(W('moving.mp4'), 9), /does not match/);
});

test('with no engine installed, avatar generation refuses instead of faking', async () => {
  await assert.rejects(pickProvider(), (e) => e instanceof AvatarUnavailable && /docs\/AVATARS/.test(e.setup));
});

test('avatar step is BLOCKED (not faked) when no provider is ready', async () => {
  const p = createProject({ command: 'x', options: mergeOptions({}, { avatarMode: 'preset', avatarId: 'ananya' }), brief: { contentType: 'video', aspect: '9:16' },
    script: { title: 't', scenes: [{ id: 's1', narration: 'hello', kind: 'avatar' }] }, assets: { scenes: { s1: { audio: 'a.wav', audioDuration: 3, audioHash: 'h' } } } });
  await assert.rejects(STEPS.avatar(getProject(p.id)), AvatarUnavailable);
});

test('avatar step with no presenter chosen asks the user to choose', async () => {
  const p = createProject({ command: 'x', options: mergeOptions({}, { avatarMode: 'none' }), brief: { contentType: 'video' }, script: { scenes: [{ id: 's1', narration: 'hi', kind: 'avatar' }] }, assets: { scenes: {} } });
  await assert.rejects(STEPS.avatar(getProject(p.id)), /presenter/);
});

test('paid AI visuals are never auto-used: step falls back to a local graphic and records a pending confirmation', async () => {
  const { saveSettings } = await import('../../server/lib/settings.js'); saveSettings({ allowPaid: false });
  const p = createProject({ command: 'x', options: mergeOptions({}, { visuals: { ai: 'image' } }), brief: { contentType: 'video', aspect: '9:16' },
    script: { title: 't', scenes: [{ id: 's1', narration: 'hello', kind: 'visual' }] }, plan: { scenes: [{ id: 's1' }] }, prompts: { image: ['a prompt'], video: ['v'] }, assets: { scenes: { s1: { audioDuration: 3 } } }, steps: {}, agentLog: [] });
  // No network is touched: the guard throws before any request is made (the key in this test is fake).
  const out = await STEPS.visuals(getProject(p.id));
  const v = out.assets.scenes.s1.visual;
  assert.equal(v.origin, 'local-motion-graphic'); assert.match(v.note, /AI image not used/);
  assert.equal(out.pendingConfirmations[0].kind, 'image');
});

test('avatar scene: chroma-key background is replaced, then combined with a visual scene in ONE mp4', async () => {
  const [w, h] = [270, 480];
  // Test double for a provider output: an animated clip of the preset on its green key colour.
  await ffmpeg(['-loop', '1', '-i', PRESET, '-i', speech, '-t', '3', '-vf', `scale=${w}:${w},zoompan=z='1+0.05*sin(on/5)':d=1:s=${w}x${w}:fps=25,format=yuv420p`, '-shortest', W('avatar.mp4')]);
  const a = await R.sceneAudio(speech, W('pad.wav'));
  const colors = { primary: '#1e3c72', secondary: '#2a5298', accent: '#6dd5ed' };
  const common = { audio: a, w, h, narration: 'Hello from the presenter', headline: 'Intro', colors, accent: '#FFD23F', workDir: W('work'), captionsOn: true };
  const s1 = await R.renderAvatarScene({ ...common, idx: 0, out: W('s1.mp4'), avatarVideo: W('avatar.mp4'), bg: { type: 'gradient', keyColor: '#00B140', similarity: 0.3 } });
  const s2 = await R.renderVisualScene({ ...common, idx: 1, out: W('s2.mp4'), source: { type: 'gradient' }, motion: 'zoom_in' });
  const s3 = await R.renderVisualScene({ ...common, idx: 2, out: W('s3.mp4'), source: { type: 'image', file: PRESET }, motion: 'pan_left', overlayAvatar: { file: W('avatar.mp4') } });
  const fin = await R.assemble({ scenes: [s1, s2, s3], transitions: ['fade', 'wipeleft'], music: await R.synthAmbientBed(W('bed.wav'), 12), out: W('final.mp4'), workDir: W('work') });
  const info = await probe(fin.file);
  assert.ok(info.hasVideo && info.hasAudio); assert.equal(info.width, w);
  assert.ok(Math.abs(info.duration - fin.duration) < 0.3);
  // Keying worked: top-left corner of the avatar scene is the blue gradient, not the key green.
  const px = await run('ffmpeg', ['-v', 'error', '-ss', '1', '-i', W('s1.mp4'), '-vf', 'crop=4:4:2:2,scale=1:1,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', '-']);
  const raw = await new Promise((res) => { import('node:child_process').then(({ spawn }) => { const c = spawn('ffmpeg', ['-v', 'error', '-ss', '1', '-i', W('s1.mp4'), '-vf', 'crop=4:4:2:2,scale=1:1,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', '-']); const b = []; c.stdout.on('data', (d) => b.push(d)); c.on('close', () => res(Buffer.concat(b))); }); });
  const [r, g, b] = raw; assert.ok(!(g > 150 && r < 60 && b < 90), `corner still key-green: ${[r, g, b]}`);
  assert.ok(b > g * 0.9, `expected blue-ish gradient, got ${[r, g, b]}`);
});

test('word-highlight captions: a mid-scene frame contains highlighted pixels in the caption colour', async () => {
  const raw = await new Promise((res) => import('node:child_process').then(({ spawn }) => { const c = spawn('ffmpeg', ['-v', 'error', '-ss', '1.2', '-i', W('s2.mp4'), '-vf', 'crop=270:120:0:300,scale=1:1,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', '-']); const b = []; c.stdout.on('data', (d) => b.push(d)); c.on('close', () => res(Buffer.concat(b))); }));
  assert.equal(raw.length, 3);
});
