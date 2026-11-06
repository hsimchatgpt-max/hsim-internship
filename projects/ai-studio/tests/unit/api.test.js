import { TMP, PRESET } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { buildRouter } from '../../server/routes.js';

let server, base;
test.before(async () => {
  const app = express(); app.use('/api', buildRouter());
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

const j = (p, o) => fetch(base + p, o).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const photoForm = (consent) => { const f = new FormData(); f.append('photo', new Blob([fs.readFileSync(PRESET)], { type: 'image/png' }), 'me.png'); if (consent !== undefined) f.append('consent', consent); return f; };

test('photo upload requires the ownership/permission confirmation', async () => {
  assert.equal((await j('/photos', { method: 'POST', body: photoForm() })).status, 400);
  const r = await j('/photos', { method: 'POST', body: photoForm('false') });
  assert.equal(r.status, 400); assert.match(r.body.error, /permission/);
});

test('rejects non-images', async () => {
  const f = new FormData(); f.append('photo', new Blob(['not an image'], { type: 'image/png' }), 'x.png'); f.append('consent', 'true');
  assert.equal((await j('/photos', { method: 'POST', body: f })).status, 400);
});

test('confirmed upload keeps a READ-ONLY original, plus a separate prepared copy, with consent on record', async () => {
  const r = await j('/photos', { method: 'POST', body: photoForm('true') });
  assert.equal(r.status, 200);
  assert.ok(r.body.meta.consent.confirmedAt); assert.equal(r.body.meta.backdrop.plain, true);
  const lib = await j('/library');
  const kinds = lib.body.map((a) => a.kind).sort();
  assert.deepEqual(kinds, ['photo-original', 'photo-prepared']);
  const orig = fs.readdirSync(path.join(TMP, 'library')).map((d) => path.join(TMP, 'library', d)).filter((d) => fs.statSync(d).isDirectory()).flatMap((d) => fs.readdirSync(d).map((f) => path.join(d, f))).find((f) => /photo-original/.test(f));
  assert.equal(fs.statSync(orig).mode & 0o222, 0, 'original must be read-only');
  assert.ok((await fetch(base + r.body.url.replace('/api', ''))).ok);
});

test('settings endpoint never exposes the API key', async () => {
  process.env.GEMINI_API_KEY = 'AQ.SECRETSECRETSECRETSECRETSECRETSECRET';
  const r = await fetch(base + '/settings'); const t = await r.text();
  assert.ok(!t.includes('SECRETSECRET'));
  assert.equal((await fetch(base + '/health').then((x) => x.json())).keyConfigured, true);
});

test('project creation validates input; photo avatar needs a consented photo; file route blocks path traversal', async () => {
  assert.equal((await j('/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'x' }) })).status, 400);
  assert.equal((await j('/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'make a reel about tea', options: { avatarMode: 'photo', avatarId: 'a_nope' } }) })).status, 400);
  const ok = await j('/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'make a reel about tea' }) });
  assert.equal(ok.status, 200);
  assert.equal((await fetch(`${base}/projects/${ok.body.id}/file?path=../../../settings.json`)).status, 404);
  assert.equal((await fetch(`${base}/projects/${ok.body.id}/file?path=${encodeURIComponent('../project.json')}`)).status, 404);
});

test('paid settings: enabling does not enable anything without a price; estimate marks unpriced', async () => {
  const r = await j('/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'make a reel about tea', options: { visuals: { ai: 'video' } } }) });
  assert.equal(r.body.estimate.paid[0].priced, false); assert.equal(r.body.estimate.requiresConfirmation, true); assert.equal(r.body.estimate.totalPaidUsd, null);
});
