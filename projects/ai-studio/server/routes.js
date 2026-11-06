import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { dirs, geminiKey, ROOT } from './config.js';
import { getSettings, saveSettings } from './lib/settings.js';
import { getRates, saveRates } from './lib/pricing.js';
import { usageToday, usageAll } from './lib/ledger.js';
import { getModelList, capabilityReport, loadStatus } from './lib/models.js';
import { listModels, generateContent, textOf, GeminiError } from './lib/gemini.js';
import { probeModel } from './lib/mediagen.js';
import { VOICES, LANGUAGES, TONES } from './lib/voices.js';
import { previewVoice } from './lib/tts.js';
import * as store from './lib/store.js';
import { probe, ffmpeg } from './lib/util.js';
import { PRESETS, BACKGROUNDS } from './avatar/presets.js';
import { providerStatuses } from './avatar/index.js';
import { normalisePhoto, detectBackdrop, rembgAvailable, isolateOnKeyColor } from './avatar/prepare.js';
import { startRun, isRunning, invalidate, mergeOptions, DEFAULT_OPTIONS, estimateRun } from './workflow/pipeline.js';

const upload = multer({ dest: path.join(dirs.cache, 'uploads'), limits: { fileSize: 300 * 1024 * 1024 } });
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  const status = e instanceof GeminiError ? ({ auth: 401, tier_blocked: 402, confirmation_required: 402, limit_reached: 429, rate_limit: 429, quota_daily: 429, bad_request: 400, not_found: 404 }[e.kind] || 502) : 500;
  res.status(status).json({ error: e.message, kind: e.kind, estimate: e.estimate });
});

export function buildRouter() {
  const r = express.Router();
  r.use(express.json({ limit: '2mb' }));

  // ---------- API settings / health ----------
  r.get('/health', (q, s) => s.json({ ok: true, keyConfigured: !!geminiKey() }));

  r.get('/settings', wrap(async (q, s) => {
    let models = null, capabilities = null, modelError = null;
    if (geminiKey()) { try { models = (await getModelList()).length; capabilities = await capabilityReport(); } catch (e) { modelError = e.message; } }
    s.json({
      keyConfigured: !!geminiKey(), // the key itself is never sent to the browser
      settings: getSettings(), rates: getRates(), usageToday: usageToday(), modelStatus: loadStatus(),
      modelCount: models, capabilities, modelError, providers: await providerStatuses(),
    });
  }));
  r.put('/settings', (q, s) => s.json(saveSettings(q.body || {})));
  r.put('/pricing', (q, s) => s.json(saveRates(q.body || {})));
  r.get('/usage', (q, s) => s.json(usageAll()));

  r.post('/connection-test', wrap(async (q, s) => {
    if (!geminiKey()) return s.status(400).json({ ok: false, error: 'GEMINI_API_KEY is not set on the server (.env).' });
    const t0 = Date.now(); const out = { ok: false, steps: [] };
    try { const m = await listModels(); out.steps.push({ name: 'List models', ok: true, detail: `${m.length} models visible to this key` }); }
    catch (e) { out.steps.push({ name: 'List models', ok: false, detail: e.message, kind: e.kind }); return s.json(out); }
    const { resolveModel } = await import('./lib/models.js'); const { available } = await resolveModel('text');
    let last;
    for (const model of available.slice(0, 3)) {
      try {
        const resp = await generateContent(model, { contents: [{ parts: [{ text: 'Reply with the single word: pong' }] }], generationConfig: { maxOutputTokens: 256 } }, { kind: 'text', maxTries: 2 });
        out.steps.push({ name: `Text generation (${model})`, ok: true, detail: `replied "${textOf(resp).trim().slice(0, 40)}"${last ? ` — after ${last.model} failed: ${last.msg}` : ''}` }); last = null; break;
      } catch (e) { last = { model, msg: e.message, kind: e.kind }; if (!['server', 'rate_limit', 'tier_blocked'].includes(e.kind)) break; }
    }
    if (last) out.steps.push({ name: `Text generation (${last.model})`, ok: false, detail: last.msg, kind: last.kind });
    out.ok = out.steps.every((x) => x.ok); out.ms = Date.now() - t0; s.json(out);
  }));

  r.get('/models', wrap(async (q, s) => s.json({ models: await getModelList(q.query.refresh === '1'), capabilities: await capabilityReport(), status: loadStatus() })));
  // Probe a capability with one tiny real call. Paid-class probes require confirm=true (they may be billed on a paid plan).
  r.post('/models/check', wrap(async (q, s) => s.json(await probeModel(String(q.body.kind), { confirmed: !!q.body.confirm }))));

  // ---------- voices ----------
  r.get('/voices', (q, s) => s.json({ voices: VOICES, languages: LANGUAGES, tones: Object.keys(TONES), note: 'Voice list is from Google documentation (the API has no list endpoint). Previews are generated live, so an unsupported voice/language fails visibly.' }));
  r.post('/voices/preview', wrap(async (q, s) => {
    const { voice = 'Kore', language = 'en-US', tone = 'neutral', speed = 1, sample } = q.body || {};
    const p = await previewVoice({ voice, language, tone, speed: Number(speed) || 1, sample });
    s.type('audio/wav').sendFile(p.file);
  }));

  // ---------- brand ----------
  r.get('/brand', (q, s) => s.json(store.getBrand()));
  r.put('/brand', (q, s) => s.json(store.saveBrand(q.body || {})));

  // ---------- avatars ----------
  r.get('/avatars', wrap(async (q, s) => s.json({ presets: PRESETS.map(({ spec, ...x }) => x), backgrounds: BACKGROUNDS, providers: await providerStatuses(), rembg: await rembgAvailable(), photos: store.listLibrary({ kind: 'photo-original' }).map(publicAsset) })));
  r.get('/avatars/preset/:id.png', (q, s) => {
    const p = PRESETS.find((x) => x.id === q.params.id); if (!p) return s.sendStatus(404);
    s.sendFile(path.join(ROOT, 'server/assets/avatars', `${p.id}.png`));
  });

  r.post('/photos', upload.single('photo'), wrap(async (q, s) => {
    const f = q.file; const cleanup = () => f && fs.rmSync(f.path, { force: true });
    try {
      if (!f) return s.status(400).json({ error: 'No file uploaded.' });
      if (q.body.consent !== 'true') return s.status(400).json({ error: 'You must confirm that you own this photo or have permission to use it.' });
      const info = await probe(f.path).catch(() => null);
      if (!info?.hasVideo || !info.width || info.duration > 1) return s.status(400).json({ error: 'That file is not a valid still image.' });
      if (info.width < 256 || info.height < 256) return s.status(400).json({ error: 'Image is too small (minimum 256×256).' });
      const ext = path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.png';
      const consent = { confirmedAt: new Date().toISOString(), statement: 'User confirmed they own this photo or have permission to use it.' };
      const original = store.addAsset({ kind: 'photo-original', name: q.body.name || f.originalname, srcFile: f.path, ext, mime: f.mimetype, readonly: true, meta: { consent, width: info.width, height: info.height } });
      const prepared = path.join(dirs.cache, `${original.id}.prep.png`);
      await normalisePhoto(store.assetPath(original), prepared);
      const prep = store.addAsset({ kind: 'photo-prepared', name: `${original.name} (prepared)`, srcFile: prepared, ext: '.png', mime: 'image/png', sourceId: original.id });
      fs.rmSync(prepared, { force: true });
      const backdrop = await detectBackdrop(store.assetPath(prep));
      // Avatars are generated from the prepared copy; the original stays untouched in the library.
      store.updateAssetMeta(original.id, { consent, preparedAssetId: prep.id, backdrop });
      s.json(publicAsset(store.getAsset(original.id)));
    } finally { cleanup(); }
  }));
  // Cut the person out (needs the optional `rembg` Python package) so the backdrop can be replaced exactly.
  r.post('/photos/:id/isolate', wrap(async (q, s) => {
    const a = store.getAsset(q.params.id); if (!a || a.kind !== 'photo-original') return s.sendStatus(404);
    if (!(await rembgAvailable())) return s.status(501).json({ error: 'Background removal needs the optional Python package "rembg" (pip install rembg). It is not installed here, so use a photo with a plain background and the colour-key option instead.' });
    const prep = store.getAsset(a.meta.preparedAssetId); const out = path.join(dirs.cache, `${a.id}.iso.png`);
    await isolateOnKeyColor(store.assetPath(prep), out);
    const iso = store.addAsset({ kind: 'photo-isolated', name: `${a.name} (isolated)`, srcFile: out, ext: '.png', mime: 'image/png', sourceId: a.id });
    fs.rmSync(out, { force: true });
    store.updateAssetMeta(a.id, { isolatedAssetId: iso.id }); s.json(publicAsset(store.getAsset(a.id)));
  }));

  // ---------- library ----------
  r.get('/library', (q, s) => s.json(store.listLibrary(q.query.kind ? { kind: String(q.query.kind) } : {}).map(publicAsset)));
  r.post('/library/upload', upload.single('file'), wrap(async (q, s) => {
    const f = q.file; try {
      if (!f) return s.status(400).json({ error: 'No file uploaded.' });
      const kind = ['image', 'clip', 'music', 'logo', 'background'].includes(q.body.kind) ? q.body.kind : null;
      if (!kind) return s.status(400).json({ error: 'kind must be image, clip, music, logo or background.' });
      if (q.body.rights !== 'true') return s.status(400).json({ error: 'Confirm that you have the rights to use this media.' });
      const info = await probe(f.path).catch(() => null);
      if (!info) return s.status(400).json({ error: 'Could not read that media file.' });
      if (kind === 'music' && !info.hasAudio) return s.status(400).json({ error: 'No audio found in that file.' });
      if (kind !== 'music' && !info.hasVideo) return s.status(400).json({ error: 'No picture found in that file.' });
      const mime = kind === 'clip' ? (f.mimetype.startsWith('video') ? f.mimetype : 'video/mp4') : f.mimetype;
      const a = store.addAsset({ kind, name: q.body.name || f.originalname, srcFile: f.path, ext: path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g, ''), mime, meta: { width: info.width, height: info.height, duration: info.duration, rights: { confirmedAt: new Date().toISOString() } } });
      s.json(publicAsset(a));
    } finally { f && fs.rmSync(f.path, { force: true }); }
  }));
  r.get('/library/:id/file', (q, s) => { const a = store.getAsset(q.params.id); if (!a) return s.sendStatus(404); s.type(a.mime || 'application/octet-stream').sendFile(store.assetPath(a)); });
  r.delete('/library/:id', (q, s) => {
    const a = store.getAsset(q.params.id); if (!a) return s.sendStatus(404);
    for (const id of [a.meta?.preparedAssetId, a.meta?.isolatedAssetId].filter(Boolean)) store.deleteAsset(id);
    s.json({ deleted: store.deleteAsset(q.params.id) });
  });

  // ---------- projects ----------
  const full = (p) => ({ ...p, running: isRunning(p.id), estimate: estimateRun(p) });
  const getP = (q, s) => { const p = store.getProject(q.params.id); if (!p) { s.status(404).json({ error: 'Project not found' }); return null; } return p; };

  r.get('/projects', (q, s) => s.json(store.listProjects()));
  r.get('/defaults', (q, s) => s.json(DEFAULT_OPTIONS));
  r.post('/projects', wrap(async (q, s) => {
    const command = String(q.body.command || '').trim();
    if (command.length < 5) return s.status(400).json({ error: 'Describe what you want to create (at least a few words).' });
    const options = mergeOptions({}, q.body.options || {});
    if (options.avatarMode === 'photo' && !store.getAsset(options.avatarId)?.meta?.consent) return s.status(400).json({ error: 'Pick an uploaded photo that has a consent confirmation.' });
    s.json(full(store.createProject({ command, options })));
  }));
  r.get('/projects/:id', (q, s) => { const p = getP(q, s); if (p) s.json(full(p)); });
  r.delete('/projects/:id', (q, s) => { if (isRunning(q.params.id)) return s.status(409).json({ error: 'Project is running.' }); s.json({ deleted: store.deleteProject(q.params.id) }); });

  r.post('/projects/:id/run', wrap(async (q, s) => {
    const p = getP(q, s); if (!p) return;
    const body = q.body || {};
    if (body.confirm) { p.options.confirm = { ...p.options.confirm, ...body.confirm }; store.saveProject(p); }
    if (body.options) { p.options = mergeOptions(p.options, body.options); store.saveProject(p); }
    startRun(p.id, { from: body.from }); s.status(202).json({ started: true });
  }));
  r.post('/projects/:id/approve', wrap(async (q, s) => {
    const p = getP(q, s); if (!p) return; p.scriptApproved = true; p.steps.approval = { status: 'pending' }; store.saveProject(p);
    startRun(p.id); s.status(202).json({ started: true });
  }));
  r.post('/projects/:id/revise-script', wrap(async (q, s) => {
    const p = getP(q, s); if (!p) return; p.scriptFeedback = String(q.body.feedback || '').slice(0, 1000); p.revisions.push({ at: new Date().toISOString(), what: 'script rewrite requested', feedback: p.scriptFeedback });
    store.saveProject(p); startRun(p.id, { from: 'script' }); s.status(202).json({ started: true });
  }));

  // Edit individual parts. Only the affected downstream steps are invalidated; per-scene hashes mean untouched scenes are not regenerated.
  r.patch('/projects/:id', wrap(async (q, s) => {
    const p = getP(q, s); if (!p) return; if (isRunning(p.id)) return s.status(409).json({ error: 'Wait for the current run to finish.' });
    const b = q.body || {}; const rev = [];
    if (b.options) {
      const before = JSON.stringify(p.options.voice);
      p.options = mergeOptions(p.options, b.options);
      if (b.options.voice && JSON.stringify(p.options.voice) !== before) { p.voiceLock = null; invalidate(p, 'voice'); rev.push('voice settings'); }
      else if (b.options.avatarId !== undefined || b.options.avatarMode || b.options.avatarProvider) { invalidate(p, 'avatar'); rev.push('avatar'); }
      else invalidate(p, p.brief?.contentType === 'image' ? 'background' : 'visuals');
      if (b.options.visuals || b.options.music !== undefined || b.options.avatarBg || b.options.quality || b.options.captions !== undefined) rev.push('render options');
    }
    if (b.script?.scenes && p.script) {
      const byId = new Map(p.script.scenes.map((x) => [x.id, x])); const next = [];
      let structural = b.script.scenes.length !== p.script.scenes.length;
      for (const e of b.script.scenes) {
        const old = e.id && byId.get(e.id);
        if (old) { structural ||= e.kind && e.kind !== old.kind; next.push({ ...old, ...pick(e, ['narration', 'onScreenText', 'kind', 'mediaAssetId']) }); }
        else { structural = true; next.push({ id: 's' + (Date.now().toString(36) + next.length), narration: String(e.narration || ''), onScreenText: String(e.onScreenText || ''), kind: ['avatar', 'visual', 'avatar_pip'].includes(e.kind) ? e.kind : 'visual' }); }
      }
      if (next.some((x) => !x.narration.trim())) return s.status(400).json({ error: 'Every scene needs narration text.' });
      p.script = { ...p.script, ...(b.script.title ? { title: String(b.script.title) } : {}), scenes: next };
      p.scriptApproved = false; invalidate(p, structural ? 'plan' : 'voice'); rev.push('script');
      if (!structural) p.steps.approval = { status: 'pending' };
    }
    if (b.plan?.scenes && p.plan) {
      for (const e of b.plan.scenes) { const t = p.plan.scenes.find((x) => x.id === e.id); if (t) Object.assign(t, pick(e, ['motion', 'transition', 'visualDescription'])); }
      for (const k of Object.keys(p.assets?.scenes || {})) delete p.assets.scenes[k].sceneHash;
      invalidate(p, 'edit'); rev.push('scene plan');
    }
    if (b.copy && p.copy) { Object.assign(p.copy, pick(b.copy, ['headline', 'subhead', 'body', 'cta', 'imagePrompt'])); invalidate(p, 'design'); rev.push('copy'); }
    if (b.social && p.social) Object.assign(p.social, pick(b.social, ['caption', 'hashtags']));
    if (rev.length) p.revisions.push({ at: new Date().toISOString(), what: 'edited ' + rev.join(', ') });
    s.json(full(store.saveProject(p)));
  }));

  r.post('/projects/:id/scenes/:sid/regenerate', wrap(async (q, s) => {
    const p = getP(q, s); if (!p) return; const a = p.assets?.scenes?.[q.params.sid]; if (!a) return s.status(404).json({ error: 'Scene has no generated assets yet.' });
    const part = q.body.part;
    const map = { audio: ['audioHash', 'voice'], avatar: ['avatarHash', 'avatar'], visual: ['visualHash', 'visuals'], render: ['sceneHash', 'edit'] };
    if (!map[part]) return s.status(400).json({ error: 'part must be audio, avatar, visual or render.' });
    delete a[map[part][0]]; delete a.sceneHash;
    if (part === 'audio') delete a.avatarHash;
    if (q.body.confirm) p.options.confirm = { ...p.options.confirm, ...q.body.confirm };
    p.revisions.push({ at: new Date().toISOString(), what: `regenerate ${part} of ${q.params.sid}` }); store.saveProject(p);
    startRun(p.id, { from: map[part][1] }); s.status(202).json({ started: true });
  }));

  r.get('/projects/:id/file', (q, s) => {
    const p = getP(q, s); if (!p) return;
    const base = path.join(store.projectDir(p.id), 'files'); const target = path.resolve(base, String(q.query.path || ''));
    if (!target.startsWith(base + path.sep) || !fs.existsSync(target)) return s.sendStatus(404);
    if (q.query.download) s.download(target, q.query.name ? path.basename(String(q.query.name)) : path.basename(target)); else s.sendFile(target);
  });
  return r;
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const publicAsset = (a) => ({ id: a.id, kind: a.kind, name: a.name, mime: a.mime, meta: a.meta, sourceId: a.sourceId, projectId: a.projectId, createdAt: a.createdAt, url: `/api/library/${a.id}/file` });
