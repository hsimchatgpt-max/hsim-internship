import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as A from '../agents/agents.js';
import { getProject, saveProject, projectDir, getBrand, getAsset, assetPath, addAsset } from '../lib/store.js';
import { getSettings } from '../lib/settings.js';
import { synthesize } from '../lib/tts.js';
import { generateImage, generateVideo } from '../lib/mediagen.js';
import { estimate } from '../lib/pricing.js';
import { GeminiError } from '../lib/gemini.js';
import { ffmpeg, probe, run } from '../lib/util.js';
import { pickProvider, generateTalkingVideo, getProvider } from '../avatar/index.js';
import { AvatarUnavailable } from '../avatar/providers/base.js';
import { PRESETS, BACKGROUNDS, KEY_COLOR } from '../avatar/presets.js';
import * as R from '../video/render.js';
import { FONTS_DIR } from '../video/captions.js';
import { ROOT } from '../config.js';

const require = createRequire(import.meta.url);
export const VIDEO_STEPS = ['understand', 'brand', 'strategy', 'research', 'script', 'approval', 'plan', 'prompts', 'social', 'voice', 'avatar', 'visuals', 'edit', 'qc'];
export const IMAGE_STEPS = ['understand', 'brand', 'strategy', 'research', 'copy', 'background', 'design', 'qc'];
export const stepsFor = (p) => (p.brief?.contentType === 'image' ? IMAGE_STEPS : p.brief?.contentType === 'video' ? VIDEO_STEPS : ['understand']);

const hash = (...a) => crypto.createHash('sha1').update(JSON.stringify(a)).digest('hex').slice(0, 12);
const exists = (f) => f && fs.existsSync(f);
const files = (p, ...x) => path.join(projectDir(p.id), 'files', ...x);
const rel = (p, f) => path.relative(projectDir(p.id), f);
const sc = (p, id) => ((p.assets ||= { scenes: {} }).scenes[id] ||= {});
const logAgent = (p, r) => { p.agentLog.push({ agent: r.agent, model: r.model, tokens: r.tokens, at: new Date().toISOString() }); return r.data; };

export const DEFAULT_OPTIONS = {
  avatarMode: 'none',            // none | preset | photo
  avatarId: null,                // preset id or library asset id
  avatarProvider: null,          // null = first ready local provider
  avatarBg: { type: 'gradient', backgroundId: 'studio-blue', assetId: null, mode: 'colorkey', keyColor: null, similarity: 0.3 },
  voice: { voice: 'Kore', tone: null, speed: 1, language: null },
  visuals: { ai: 'none' },       // none | image | video  (paid-class: needs settings.allowPaid + confirmation)
  music: 'none',                 // none | ambient | <library asset id>
  captions: true, quality: 'draft', requireApproval: null,
  aspect: null, language: null, tone: null, duration: null,
  confirm: { externalAvatar: false, paid: false },   // one-shot, cleared after each run
};

export function mergeOptions(base, patch = {}) {
  const o = { ...DEFAULT_OPTIONS, ...base, ...patch };
  for (const k of ['avatarBg', 'voice', 'visuals', 'confirm']) o[k] = { ...DEFAULT_OPTIONS[k], ...(base?.[k] || {}), ...(patch?.[k] || {}) };
  return o;
}

// ---------------- jobs ----------------
const jobs = new Map();
export const isRunning = (id) => jobs.has(id);

export function invalidate(p, from) {
  const order = stepsFor(p).length > 1 ? stepsFor(p) : VIDEO_STEPS;
  const i = order.indexOf(from);
  for (const s of order.slice(i < 0 ? 0 : i)) if (p.steps[s]) p.steps[s] = { status: 'pending' };
}

export function startRun(id, { from } = {}) {
  if (jobs.has(id)) throw new Error('This project is already running.');
  const p0 = getProject(id); if (!p0) throw new Error('Project not found');
  if (from) { invalidate(p0, from); saveProject(p0); }
  const job = runProject(id).finally(() => jobs.delete(id));
  jobs.set(id, job);
  return job;
}

async function runProject(id) {
  let p = getProject(id);
  p.pendingConfirmations = []; p.blocker = null; p.status = 'running'; saveProject(p);
  let order = stepsFor(p);
  for (let i = 0; i < order.length; i++) {
    const name = order[i];
    p = getProject(id);
    if (p.steps[name]?.status === 'done') continue;
    p.steps[name] = { status: 'running', at: new Date().toISOString() }; saveProject(p);
    try {
      const res = await STEPS[name](p);
      p = res || p;
      if (p.steps[name]?.status === 'running') p.steps[name] = { status: 'done', at: new Date().toISOString() };
      saveProject(p);
      if (p.steps[name].status === 'awaiting_approval') { p.status = 'awaiting_approval'; saveProject(p); return; }
      if (name === 'understand') order = stepsFor(p);
    } catch (e) {
      p = getProject(id);
      const blocked = e instanceof AvatarUnavailable || e.kind === 'confirmation_required';
      p.steps[name] = { status: blocked ? 'blocked' : 'failed', error: e.message, kind: e.kind, setup: e.setup, at: new Date().toISOString() };
      p.status = blocked ? 'needs_input' : 'failed';
      p.blocker = { step: name, message: e.message, kind: e.kind || e.name, setup: e.setup, estimate: e.estimate };
      saveProject(p);
      return;
    }
  }
  p = getProject(id);
  p.status = 'complete'; p.options.confirm = { externalAvatar: false, paid: false }; saveProject(p);
}

// ---------------- helpers ----------------
function avatarImage(p) {
  const o = p.options;
  if (o.avatarMode === 'preset') {
    const pr = PRESETS.find((x) => x.id === o.avatarId);
    if (!pr) throw new Error('Choose a presenter first.');
    return { file: path.join(ROOT, 'server/assets/avatars', `${pr.id}.png`), key: `preset:${pr.id}`, keyColor: KEY_COLOR };
  }
  if (o.avatarMode === 'photo') {
    const a = getAsset(o.avatarId);
    if (!a) throw new Error('Choose or upload a photo first.');
    if (!a.meta?.consent) throw new Error('This photo has no ownership/permission confirmation on record.');
    const iso = a.meta?.isolatedAssetId && getAsset(a.meta.isolatedAssetId);
    const use = o.avatarBg.mode === 'rembg' && iso ? iso : a;
    return { file: assetPath(use), key: `photo:${use.id}`, keyColor: o.avatarBg.mode === 'rembg' && iso ? KEY_COLOR : (o.avatarBg.keyColor || a.meta?.backdrop?.color) };
  }
  return null;
}

function bgSpec(p) {
  const b = p.options.avatarBg;
  if (b.type === 'asset' && b.assetId) {
    const a = getAsset(b.assetId);
    if (a) return { type: a.mime?.startsWith('video') ? 'clip' : 'image', file: assetPath(a) };
  }
  const bg = BACKGROUNDS.find((x) => x.id === b.backgroundId) || BACKGROUNDS[0];
  return { type: 'gradient', colors: bg.colors };
}

const sceneList = (p) => p.script.scenes.map((s, i) => ({ ...s, plan: p.plan?.scenes?.[i] || {}, idx: i }));
const accent = (p) => p.brandSnapshot?.colors?.accent || '#FFD23F';

// ---------------- steps ----------------
export const STEPS = {
  async understand(p) {
    const o = p.options;
    const hints = { aspect: o.aspect, language: o.language, tone: o.tone, targetDurationSec: o.duration, avatar: o.avatarMode !== 'none' ? 'wants a presenter avatar' : 'no avatar' };
    const b = logAgent(p, await A.understandCommand(p.command, Object.fromEntries(Object.entries(hints).filter(([, v]) => v))));
    // The UI's explicit choices always override the model's inference.
    if (o.aspect) b.aspect = o.aspect; if (o.language) b.language = o.language; if (o.tone) b.tone = o.tone;
    if (o.duration) b.targetDurationSec = Number(o.duration);
    b.wantsAvatar = o.avatarMode !== 'none';
    if (!b.wantsAvatar) b.mixAvatarAndVisual = false;
    p.brief = b; return p;
  },
  async brand(p) { p.brandSnapshot = getBrand(); return p; },
  async strategy(p) { p.strategy = logAgent(p, await A.strategize(p.brief, p.brandSnapshot)); return p; },
  async research(p) { p.research = logAgent(p, await A.research(p.brief, p.strategy, { grounding: getSettings().grounding })); return p; },

  async script(p) {
    const s = logAgent(p, await A.writeScript(p.brief, p.strategy, p.research, p.brandSnapshot, { feedback: p.scriptFeedback }));
    if (!p.brief.wantsAvatar) s.scenes.forEach((x) => (x.kind = 'visual'));
    s.scenes.forEach((x, i) => (x.id = `s${i + 1}`));
    p.script = s; p.scriptApproved = false; p.scriptFeedback = null; return p;
  },
  async approval(p) {
    const need = p.options.requireApproval ?? getSettings().requireScriptApproval;
    if (need && !p.scriptApproved) { p.steps.approval = { status: 'awaiting_approval' }; return p; }
    p.steps.approval = { status: 'done', note: need ? 'approved' : 'skipped (approval disabled)' }; return p;
  },
  async plan(p) {
    const r = logAgent(p, await A.planScenes(p.brief, p.script, p.strategy));
    p.plan = { scenes: p.script.scenes.map((s, i) => ({ id: s.id, ...(r.scenes[i] || {}) })) }; return p;
  },
  async prompts(p) {
    // Prompts are saved for the user and are used for AI generation only if paid generation is enabled and confirmed.
    const img = logAgent(p, await A.imagePrompts(p.brief, p.plan, p.strategy, p.brandSnapshot));
    const vid = logAgent(p, await A.videoPrompts(p.brief, p.plan, p.strategy));
    p.prompts = { image: img.prompts, video: vid.prompts }; return p;
  },
  async social(p) { p.social = logAgent(p, await A.captions(p.brief, p.script, p.brandSnapshot)); return p; },

  async voice(p) {
    const o = p.options.voice;
    // Lock the voice settings at first generation so every scene (and every later regeneration) matches.
    p.voiceLock ||= { voice: o.voice, language: o.language || p.brief.language, tone: o.tone || p.brief.tone, speed: o.speed || 1, seed: 7 };
    const lock = p.voiceLock;
    for (const s of p.script.scenes) {
      const a = sc(p, s.id); const { model: _pinned, ...lockCore } = lock; const h = hash(s.narration, lockCore); // pinned model is deliberately not part of the hash
      if (a.audioHash === h && exists(files(p, a.audio || 'x'))) continue;
      const out = files(p, 'audio', `${s.id}.wav`);
      let r;
      try { r = await synthesize({ text: s.narration, ...lock, outFile: out }); }
      catch (e) {
        if (e.kind === 'quota_daily' && lock.model) e.message += ` — The voice model ${lock.model} is pinned to this project so the voice stays consistent. Wait for the quota to reset, or change the voice under "Change avatar, voice or look" to re-voice all scenes on another available TTS model.`;
        throw e;
      }
      if (!lock.model) { lock.model = r.model; } // pin the TTS model after the first scene so the whole video uses one model
      Object.assign(a, { audio: path.join('audio', `${s.id}.wav`), audioHash: h, audioDuration: r.duration, voiceModel: r.model });
      for (const k of ['avatarHash', 'sceneHash']) delete a[k];
      saveProject(p);
    }
    // One continuous voice-over file for download
    const list = p.script.scenes.map((s) => files(p, sc(p, s.id).audio));
    const listFile = files(p, 'audio', 'concat.txt');
    fs.writeFileSync(listFile, list.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'libmp3lame', '-q:a', '3', files(p, 'voiceover.mp3')]);
    p.assets.voiceover = 'voiceover.mp3'; return p;
  },

  async avatar(p) {
    const needs = p.script.scenes.filter((s) => s.kind === 'avatar' || s.kind === 'avatar_pip');
    if (!needs.length) { p.steps.avatar = { status: 'skipped', note: 'no avatar scenes' }; return p; }
    const img = avatarImage(p);
    if (!img) throw new AvatarUnavailable('Avatar scenes exist but no presenter/photo is selected. Pick an avatar, or change those scenes to visual-only.');
    const provider = await pickProvider(p.options.avatarProvider);
    const st = await provider.status();
    if (!st.ready) throw new AvatarUnavailable(`${provider.label} is not ready: ${st.reason}`, { setup: st.setup });
    if (provider.kind === 'external' && !p.options.confirm.externalAvatar)
      throw Object.assign(new GeminiError('confirmation_required', `${provider.label} will upload this image and audio to an external service (and may bill you). Confirm to proceed.`), { kind: 'confirmation_required' });
    const imgStat = fs.statSync(img.file);
    for (const s of needs) {
      const a = sc(p, s.id); const h = hash(a.audioHash, img.key, imgStat.size, provider.id);
      if (a.avatarHash === h && exists(files(p, a.avatarVideo || 'x'))) continue;
      const out = files(p, 'avatar', `${s.id}.mp4`); fs.mkdirSync(path.dirname(out), { recursive: true });
      const r = await generateTalkingVideo({ provider, image: img.file, audio: files(p, a.audio), audioDuration: a.audioDuration, out });
      Object.assign(a, { avatarVideo: path.join('avatar', `${s.id}.mp4`), avatarHash: h, avatarProvider: provider.id, avatarMotion: r.motion });
      delete a.sceneHash;
      if (p.options.avatarMode === 'photo') addAsset({ kind: 'avatar-video', name: `${p.id}-${s.id}.mp4`, srcFile: out, mime: 'video/mp4', projectId: p.id, sourceId: p.options.avatarId, meta: { provider: provider.id, scene: s.id } });
      saveProject(p);
    }
    return p;
  },

  async visuals(p) {
    const ai = p.options.visuals.ai; const confirmed = !!p.options.confirm.paid;
    const [w, h] = R.dims(p.brief.aspect, p.options.quality);
    for (const s of sceneList(p)) {
      if (s.kind === 'avatar') continue;
      const a = sc(p, s.id);
      const userAsset = s.mediaAssetId && getAsset(s.mediaAssetId);
      const hv = hash(s.mediaAssetId, ai, p.prompts?.image?.[s.idx], p.prompts?.video?.[s.idx], p.options.quality, ai !== 'none' && confirmed);
      if (a.visualHash === hv && a.visual && (a.visual.type === 'gradient' || exists(files(p, a.visual.file)))) continue;
      let v = null; const note = [];
      if (userAsset) {
        v = { type: userAsset.mime?.startsWith('video') ? 'clip' : 'image', file: path.relative(path.join(projectDir(p.id), 'files'), assetPath(userAsset)), origin: 'user-media', external: true };
      } else if (ai !== 'none') {
        try {
          const outDir = files(p, 'visuals'); fs.mkdirSync(outDir, { recursive: true });
          if (ai === 'video') { const out = path.join(outDir, `${s.id}.mp4`); await generateVideo({ prompt: p.prompts.video[s.idx], aspect: p.brief.aspect, seconds: Math.ceil(a.audioDuration + 1), outFile: out, confirmed }); v = { type: 'clip', file: path.join('visuals', `${s.id}.mp4`), origin: 'ai-video' }; }
          else { const out = path.join(outDir, `${s.id}.png`); await generateImage({ prompt: p.prompts.image[s.idx], aspect: p.brief.aspect, outFile: out, confirmed }); v = { type: 'image', file: path.join('visuals', `${s.id}.png`), origin: 'ai-image' }; }
        } catch (e) {
          if (!(e instanceof GeminiError)) throw e;
          if (e.kind === 'confirmation_required') (p.pendingConfirmations ||= []).push({ sceneId: s.id, kind: ai, message: e.message, estimate: e.estimate });
          note.push(`AI ${ai} not used: ${e.message}`);
        }
      }
      if (!v) v = { type: 'gradient', origin: 'local-motion-graphic', note: note.join(' ') || 'No media assigned: using a local animated gradient background (not AI-generated).' };
      a.visual = v; a.visualHash = hv; delete a.sceneHash; saveProject(p);
    }
    return p;
  },

  async edit(p) {
    const [w, h] = R.dims(p.brief.aspect, p.options.quality);
    const work = files(p, 'work'); const outDir = files(p, 'scenes'); fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(work, { recursive: true });
    const colors = p.brandSnapshot.colors; const bg = bgSpec(p); const img = p.script.scenes.some((s) => s.kind !== 'visual') ? avatarImage(p) : null;
    const rendered = [];
    for (const s of sceneList(p)) {
      const a = sc(p, s.id);
      if ((s.kind === 'avatar' || s.kind === 'avatar_pip') && !exists(files(p, a.avatarVideo || 'x'))) throw new AvatarUnavailable(`Scene ${s.id} needs an avatar video that hasn't been generated.`);
      const ab = p.options.avatarBg;
      const key = ab.mode === 'keep' ? null : (img?.keyColor || null);
      const h2 = hash(a.audioHash, a.avatarHash, a.visualHash, s.narration, s.onScreenText, s.kind, s.plan.motion, p.options.quality, p.options.captions, colors, bg, key, ab.similarity, p.brief.aspect);
      const out = files(p, 'scenes', `${s.id}.mp4`);
      const audio = await R.sceneAudio(files(p, a.audio), files(p, 'work', `${s.id}.pad.wav`));
      if (a.sceneHash === h && exists(out)) { rendered.push({ file: out, duration: audio.duration }); continue; }
      fs.mkdirSync(work, { recursive: true });
      const common = { audio, w, h, narration: s.narration, headline: s.onScreenText, colors, accent: accent(p), idx: s.idx, out, workDir: work, captionsOn: p.options.captions };
      if (s.kind === 'avatar') {
        const b = ab.mode === 'keep' ? { type: 'none' } : { ...bg, keyColor: key, similarity: ab.similarity };
        await R.renderAvatarScene({ ...common, avatarVideo: files(p, a.avatarVideo), bg: b });
      } else {
        const src = a.visual?.type === 'gradient' || !a.visual ? { type: 'gradient' } : { type: a.visual.type, file: files(p, a.visual.file) };
        await R.renderVisualScene({ ...common, source: src, motion: s.plan.motion, overlayAvatar: s.kind === 'avatar_pip' ? { file: files(p, a.avatarVideo) } : undefined });
      }
      a.sceneHash = h; rendered.push({ file: out, duration: audio.duration }); saveProject(p);
    }
    let music = null;
    const total = rendered.reduce((t, r) => t + r.duration, 0);
    if (p.options.music === 'ambient') music = await R.synthAmbientBed(files(p, 'work', 'ambient.wav'), total + 2);
    else if (p.options.music && p.options.music !== 'none') { const m = getAsset(p.options.music); if (m) music = assetPath(m); }
    const transitions = p.plan.scenes.slice(1).map((x) => x.transition || 'fade');
    const fin = await R.assemble({ scenes: rendered, transitions, music, out: files(p, 'final.mp4'), workDir: work });
    p.assets.final = 'final.mp4'; p.assets.finalDuration = fin.duration; p.assets.finalAt = new Date().toISOString(); return p;
  },

  async qc(p) { return qualityControl(p); },

  // ---------- image posts ----------
  async copy(p) { p.copy = logAgent(p, await A.imageContent(p.brief, p.strategy, p.research, p.brandSnapshot)); p.social = { caption: p.copy.caption, hashtags: p.copy.hashtags }; return p; },
  async background(p) {
    const [w, h] = R.dims(p.brief.aspect, 'final'); const out = files(p, 'bg.png'); fs.mkdirSync(path.dirname(out), { recursive: true });
    const ua = p.options.imageAssetId && getAsset(p.options.imageAssetId);
    const ai = p.options.visuals.ai === 'image'; p.assets ||= { scenes: {} };
    if (ua) { fs.copyFileSync(assetPath(ua), out); p.assets.bgOrigin = 'user-media'; return p; }
    if (ai) {
      try { await generateImage({ prompt: p.copy.imagePrompt, aspect: p.brief.aspect, outFile: out, confirmed: !!p.options.confirm.paid }); p.assets.bgOrigin = 'ai-image'; return p; }
      catch (e) { if (!(e instanceof GeminiError)) throw e; if (e.kind === 'confirmation_required') p.pendingConfirmations = [{ kind: 'image', message: e.message, estimate: e.estimate }]; p.assets.bgNote = `AI image not used: ${e.message}`; }
    }
    const c = p.brandSnapshot.colors;
    await ffmpeg(['-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=${c.primary.replace('#', '0x')}:c1=${c.secondary.replace('#', '0x')}:x0=0:y0=0:x1=${w}:y1=${h}:d=1:r=1`, '-frames:v', '1', '-update', '1', out]);
    p.assets.bgOrigin = 'local-gradient'; return p;
  },
  async design(p) { return renderDesign(p); },
};

async function renderDesign(p) {
  const { chromium } = require('playwright');
  const [w, h] = R.dims(p.brief.aspect, 'final'); const c = p.brandSnapshot.colors; const cp = p.copy;
  const logo = p.brandSnapshot.logoAssetId && getAsset(p.brandSnapshot.logoAssetId);
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const fu = (f) => pathToFileURL(f).href;
  const hasBgImage = p.assets.bgOrigin !== 'local-gradient';
  const html = `<!doctype html><meta charset=utf-8><style>
@font-face{font-family:N;src:url(${fu(path.join(FONTS_DIR, 'NotoSans_700Bold.ttf'))});font-weight:700}
@font-face{font-family:D;src:url(${fu(path.join(FONTS_DIR, 'NotoSansDevanagari_700Bold.ttf'))});font-weight:700}
*{box-sizing:border-box}body{margin:0;width:${w}px;height:${h}px;font-family:N,D,sans-serif;font-weight:700;position:relative;overflow:hidden;color:#fff;background:url(${fu(files(p, 'bg.png'))}) center/cover}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,${hasBgImage ? .35 : .08}) 0%,rgba(0,0,0,${hasBgImage ? .7 : .35}) 100%)}
.wrap{position:absolute;left:${Math.round(w * .07)}px;right:${Math.round(w * .07)}px;top:${Math.round(w * .06 + w * .11)}px;bottom:${Math.round(w * .06)}px;display:flex;flex-direction:column;justify-content:center;gap:.6em;font-size:${Math.round(w * .034)}px;overflow:hidden}
h1{font-size:2.9em;line-height:1.1;margin:0;text-shadow:0 4px 24px rgba(0,0,0,.45)}
h2{font-size:1.25em;font-weight:700;margin:0;color:${c.accent};line-height:1.25}
p{font-size:1em;margin:0;line-height:1.4;opacity:.95;max-width:92%}
.cta{align-self:flex-start;margin-top:.5em;background:${c.accent};color:#111;padding:.7em 1.4em;border-radius:999px;font-size:1.05em}
.brand{position:absolute;left:${Math.round(w * .07)}px;top:${Math.round(w * .06)}px;display:flex;align-items:center;gap:16px;font-size:${Math.round(w * .03)}px}
.brand img{height:${Math.round(w * .08)}px;border-radius:12px}</style>
<div class=shade></div>
<div class=brand>${logo ? `<img src="${fu(assetPath(logo))}">` : ''}<span>${esc(p.brandSnapshot.name)}</span></div>
<div class=wrap><h1>${esc(cp.headline)}</h1><h2>${esc(cp.subhead)}</h2><p>${esc(cp.body)}</p>${cp.cta ? `<div class=cta>${esc(cp.cta)}</div>` : ''}</div>`;
  const htmlFile = files(p, 'design.html'); fs.writeFileSync(htmlFile, html);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(pathToFileURL(htmlFile).href); await page.evaluate(() => document.fonts.ready);
    // Auto-fit: shrink the type until the copy fits the safe area, so text can never overlap the brand bar or be cut off.
    const fit = await page.evaluate(() => { const el = document.querySelector('.wrap'); const base = parseFloat(getComputedStyle(el).fontSize); let k = 1; while (el.scrollHeight > el.clientHeight + 1 && k > 0.4) { k -= 0.04; el.style.fontSize = base * k + 'px'; } return { k, fits: el.scrollHeight <= el.clientHeight + 1 }; });
    if (!fit.fits) p.assets.designWarning = 'Copy is too long for this canvas even at the smallest size — shorten it.'; else delete p.assets.designWarning;
    await page.screenshot({ path: files(p, 'post.png') });
  } finally { await browser.close(); }
  await ffmpeg(['-i', files(p, 'post.png'), '-q:v', '2', '-frames:v', '1', '-update', '1', files(p, 'post.jpg')]);
  p.assets.final = 'post.png'; p.assets.finalJpg = 'post.jpg'; p.assets.finalAt = new Date().toISOString(); return p;
}

async function qualityControl(p) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  let frames = []; let content;
  if (p.brief.contentType === 'video') {
    const info = await probe(files(p, p.assets.final));
    const [w, h] = R.dims(p.brief.aspect, p.options.quality);
    add('Has video + audio streams', info.hasVideo && info.hasAudio, `${info.hasVideo ? 'video' : 'no video'}, ${info.hasAudio ? 'audio' : 'no audio'}`);
    add('Resolution matches aspect ratio', info.width === w && info.height === h, `${info.width}x${info.height}`);
    const exp = p.script.scenes.reduce((t, s) => t + sc(p, s.id).audioDuration, 0);
    add('Duration covers all narration', info.duration >= exp, `${info.duration.toFixed(1)}s video vs ${exp.toFixed(1)}s speech`);
    const vol = await run('ffmpeg', ['-hide_banner', '-i', files(p, p.assets.final), '-af', 'volumedetect', '-vn', '-f', 'null', '-']);
    const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(vol.stderr)?.[1] ?? -91);
    add('Audio is not silent', mean > -45, `mean volume ${mean} dB`);
    for (const s of p.script.scenes.filter((x) => x.kind !== 'visual')) add(`Scene ${s.id} avatar verified animated`, (sc(p, s.id).avatarMotion ?? 0) >= 0.05, `motion ${(sc(p, s.id).avatarMotion ?? 0).toFixed(2)}`);
    frames = await R.sampleFrames(files(p, p.assets.final), 3, files(p, 'work'));
    content = { title: p.script.title, scenes: p.script.scenes.map((s) => ({ kind: s.kind, narration: s.narration, onScreenText: s.onScreenText })), social: p.social };
  } else {
    const info = await probe(files(p, 'post.png')); const [w, h] = R.dims(p.brief.aspect, 'final');
    add('Image matches aspect ratio', info.width === w && info.height === h, `${info.width}x${info.height}`);
    frames = [fs.readFileSync(files(p, 'post.jpg')).toString('base64')];
    content = p.copy;
  }
  let model = null;
  try {
    const r = await A.qualityCheck(p.brief, content, p.brandSnapshot, frames);
    logAgent(p, r); model = r.model; p.qc = { ...r.data, checks, model };
  } catch (e) { p.qc = { score: null, pass: false, reviewed: false, issues: [], summary: `AI review did NOT run (${e.message.slice(0, 140)}). Only the automatic technical checks below were applied — please review manually, or re-run QC later.`, checks }; }
  if (p.qc.reviewed !== false) p.qc.reviewed = true;
  p.qc.pass = p.qc.pass && checks.every((c) => c.ok);
  return p;
}

/** Pre-flight estimate shown to the user before they run: free-quota usage, and any paid-class generation. */
export function estimateRun(p) {
  const s = getSettings();
  const scenes = p.script?.scenes?.length || Math.max(3, Math.round((Number(p.options.duration) || 30) / 7));
  const isImage = p.brief?.contentType === 'image';
  const out = { freeQuota: { text: isImage ? 7 : 9, tts: isImage ? 0 : scenes }, paid: [], external: [], notes: [] };
  if (p.options.visuals.ai === 'image') out.paid.push(estimate('image', isImage ? 1 : p.script?.scenes?.filter((x) => x.kind !== 'avatar').length || scenes));
  if (p.options.visuals.ai === 'video') out.paid.push(estimate('video', (p.script?.scenes?.filter((x) => x.kind !== 'avatar').length || scenes) * 7));
  if (p.options.avatarMode !== 'none' && p.options.avatarProvider && getProvider(p.options.avatarProvider)?.kind === 'external') out.external.push('Photo + audio are uploaded to the external avatar service');
  out.requiresConfirmation = out.paid.length > 0 || out.external.length > 0;
  out.allowPaid = s.allowPaid;
  out.totalPaidUsd = out.paid.every((e) => e.priced) ? +out.paid.reduce((t, e) => t + e.usd, 0).toFixed(4) : null;
  return out;
}
