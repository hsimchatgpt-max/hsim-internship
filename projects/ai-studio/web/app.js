// AI Studio frontend. The browser never sees the Gemini key; everything goes through /api.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const main = $('#main');

async function api(path, opts = {}) {
  const o = { ...opts }; if (o.json) { o.method ||= 'POST'; o.headers = { 'content-type': 'application/json' }; o.body = JSON.stringify(o.json); delete o.json; }
  const r = await fetch('/api' + path, o); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  if (!r.ok) throw Object.assign(new Error(b?.error || r.statusText), { kind: b?.kind, estimate: b?.estimate, status: r.status });
  return b;
}
const toast = (m, bad) => { const d = document.createElement('div'); d.className = 'banner ' + (bad ? 'err' : 'ok'); d.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:20;max-width:420px'; d.textContent = m; document.body.append(d); setTimeout(() => d.remove(), bad ? 7000 : 3000); };
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
const modal = (html) => { const m = $('#modal'); m.innerHTML = `<div class="box">${html}</div>`; m.hidden = false; m.onclick = (e) => { if (e.target === m) m.hidden = true; }; return m; };
const closeModal = () => ($('#modal').hidden = true);
const prefs = { get: () => JSON.parse(localStorage.getItem('prefs') || '{}'), set: (p) => localStorage.setItem('prefs', JSON.stringify({ ...prefs.get(), ...p })) };
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());

const PAGES = { create: 'Create', projects: 'Projects', avatars: 'Avatars', voice: 'Voice', library: 'Library', brand: 'Brand', settings: 'API Settings' };
$('#nav').innerHTML = Object.entries(PAGES).map(([k, v]) => `<a data-p="${k}" href="#/${k}">${v}</a>`).join('');
let poll = null;
async function route() {
  clearInterval(poll); closeModal();
  const [, page = 'create', arg] = location.hash.split('/');
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.p === (page === 'project' ? 'projects' : page)));
  main.innerHTML = '<p class="muted">Loading…</p>';
  try { await ({ create: pageCreate, projects: pageProjects, project: pageProject, avatars: pageAvatars, voice: pageVoice, library: pageLibrary, brand: pageBrand, settings: pageSettings }[page] || pageCreate)(arg); }
  catch (e) { main.innerHTML = `<div class="banner err">${esc(e.message)}</div>`; }
}
addEventListener('hashchange', route);
api('/health').then((h) => ($('#keystate').innerHTML = h.keyConfigured ? '<span class="ok">● Gemini key configured (server-side)</span>' : '<span class="bad-t">● GEMINI_API_KEY missing — set it in .env</span>'));

// ---------- shared components ----------
function avatarPicker(data, sel, onPick) {
  return `<div class="grid">${data.presets.map((p) => `<div class="av ${sel === p.id ? 'sel' : ''}" data-av="${p.id}"><img src="/api/avatars/preset/${p.id}.png" loading="lazy"><b>${esc(p.name)}</b><span class="small muted">${esc(p.gender)} · ${esc(p.style)}</span></div>`).join('')}</div>`;
}
const bgOptions = (data, sel) => data.backgrounds.map((b) => `<option value="${b.id}" ${sel === b.id ? 'selected' : ''}>${esc(b.label)}</option>`).join('');
const stepPill = (n, s) => `<span class="step ${s?.status || ''}" title="${esc(s?.error || s?.note || '')}">${esc(n)}</span>`;

// ---------- CREATE ----------
async function pageCreate() {
  const [av, voices, defaults, lib] = await Promise.all([api('/avatars'), api('/voices'), api('/defaults'), api('/library')]);
  const pr = prefs.get(); let mode = pr.avatarMode || 'none', avId = pr.avatarId || null;
  const music = lib.filter((a) => a.kind === 'music');
  main.innerHTML = `<h2>Create</h2>
  <div class="card"><label>What should Gemini make?</label>
    <textarea id="cmd" placeholder="e.g. A 30-second Hinglish Instagram Reel about why organic vegetables are worth it — presenter intro and outro, cinematic visuals in the middle"></textarea>
    <div class="row" style="margin-top:12px">
      <div class="col"><label>Avatar</label><select id="mode"><option value="none">None — visual-only</option><option value="preset">Ready-made presenter</option><option value="photo">My own photo</option></select></div>
      <div class="col"><label>Aspect (auto if blank)</label><select id="aspect"><option value="">Auto</option><option>9:16</option><option>16:9</option><option>1:1</option><option>4:5</option></select></div>
      <div class="col"><label>Language</label><select id="lang"><option value="">Auto</option>${voices.languages.map((l) => `<option value="${l.code}">${esc(l.label)}</option>`).join('')}</select></div>
      <div class="col"><label>Tone</label><select id="tone"><option value="">Auto</option>${voices.tones.map((t) => `<option>${t}</option>`).join('')}</select></div>
      <div class="col"><label>Length (s)</label><input id="dur" type="number" min="10" max="90" placeholder="auto" style="width:90px"></div>
    </div>
    <div id="avBox"></div>
    <div class="row" style="margin-top:12px">
      <div class="col"><label>Voice</label><select id="voice">${voices.voices.map((v) => `<option value="${v.name}" ${v.name === (pr.voice || 'Kore') ? 'selected' : ''}>${v.name} — ${v.presentation}, ${v.style}</option>`).join('')}</select></div>
      <div class="col"><label>Speed</label><input id="speed" type="number" step="0.05" min="0.7" max="1.4" value="${pr.speed || 1}" style="width:80px"></div>
      <div class="col"><label>Visuals</label><select id="vis"><option value="none">My media or local graphics (free)</option><option value="image">Gemini images (PAID — confirm)</option><option value="video">Gemini Omni video (PAID — confirm)</option></select></div>
      <div class="col"><label>Music</label><select id="music"><option value="none">None</option><option value="ambient">Ambient bed (synthesised locally)</option>${music.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div>
      <div class="col"><label>Quality</label><select id="q"><option value="draft">Draft (fast, half-res)</option><option value="final">Final (full-res)</option></select></div>
    </div>
    <div class="row" style="margin-top:12px"><label><input type="checkbox" id="cap" checked> Animated captions</label><label><input type="checkbox" id="appr" checked> Ask me to approve the script before voice/video</label></div>
    <div style="margin-top:14px"><button id="go">Generate</button> <span class="small muted">Nothing paid ever runs without an explicit confirmation.</span></div>
  </div>`;
  const drawAv = () => {
    $('#mode').value = mode; const box = $('#avBox');
    if (mode === 'preset') box.innerHTML = `<h3>Presenter</h3>${avatarPicker(av, avId)}<div class="row" style="margin-top:10px"><div class="col"><label>Background</label><select id="bg">${bgOptions(av, pr.bg)}</select></div></div>`;
    else if (mode === 'photo') box.innerHTML = `<h3>Your photo</h3>${av.photos.length ? `<div class="grid">${av.photos.map((p) => `<div class="av ${avId === p.id ? 'sel' : ''}" data-av="${p.id}"><img src="${p.url}"><b>${esc(p.name)}</b></div>`).join('')}</div>` : '<p class="muted">No photos yet — upload one on the Avatars page.</p>'}<div class="row" style="margin-top:10px"><div class="col"><label>Background</label><select id="bg">${bgOptions(av, pr.bg)}</select></div></div>`;
    else box.innerHTML = '';
    box.querySelectorAll('[data-av]').forEach((e) => (e.onclick = () => { avId = e.dataset.av; drawAv(); }));
  };
  $('#mode').onchange = (e) => { mode = e.target.value; avId = null; drawAv(); }; drawAv();
  $('#go').onclick = guard(async () => {
    if (mode !== 'none' && !avId) throw new Error('Choose a presenter or photo first.');
    const ai = $('#vis').value; let confirm = false;
    const options = { avatarMode: mode, avatarId: avId, requireApproval: $('#appr').checked, captions: $('#cap').checked, quality: $('#q').value, music: $('#music').value,
      aspect: $('#aspect').value || null, language: $('#lang').value || null, tone: $('#tone').value || null, duration: $('#dur').value || null,
      voice: { voice: $('#voice').value, speed: Number($('#speed').value) || 1 }, visuals: { ai }, avatarBg: { backgroundId: $('#bg')?.value || 'studio-blue', mode: 'colorkey' } };
    prefs.set({ avatarMode: mode, avatarId: avId, voice: $('#voice').value, speed: options.voice.speed, bg: $('#bg')?.value });
    const p = await api('/projects', { json: { command: $('#cmd').value, options } });
    if (p.estimate.requiresConfirmation) confirm = await confirmCost(p.estimate);
    if (p.estimate.requiresConfirmation && !confirm) return toast('Cancelled — nothing paid was run.');
    await api(`/projects/${p.id}/run`, { json: { confirm: { paid: confirm, externalAvatar: confirm } } });
    location.hash = `#/project/${p.id}`;
  });
}
function confirmCost(est) {
  return new Promise((res) => {
    const paid = est.paid.map((e) => `<li>${fmt(e.units)} × ${esc(e.unit)} ${e.priced ? `≈ <b>$${e.usd}</b>` : '<span class="warn">price not set (API Settings) — will be refused</span>'}</li>`).join('');
    modal(`<h3>Confirm paid / external processing</h3><ul>${paid}${est.external.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <p class="small muted">${est.allowPaid ? '' : '<b class="warn">"Allow paid generation" is OFF in API Settings, so paid steps will still be refused.</b><br>'}This is an estimate. Google bills based on its own pricing. If your key is on the free tier these models will return “quota 0” and nothing is charged.</p>
      <div class="row"><button id="yes">I confirm</button><button class="sec" id="no">Cancel</button></div>`);
    $('#yes').onclick = () => { closeModal(); res(true); }; $('#no').onclick = () => { closeModal(); res(false); };
  });
}

// ---------- PROJECTS ----------
async function pageProjects() {
  const list = await api('/projects');
  main.innerHTML = `<h2>Projects</h2><div class="card">${list.length ? `<table><tr><th>Title</th><th>Type</th><th>Status</th><th>Updated</th><th></th></tr>${list.map((p) => `<tr><td><a href="#/project/${p.id}" style="color:var(--accent)">${esc(p.title || p.command)}</a></td><td>${esc(p.contentType || '—')}</td><td><span class="pill ${p.status === 'complete' ? 'ok' : p.status === 'failed' ? 'err' : 'warn'}">${esc(p.status)}</span></td><td class="small muted">${new Date(p.updatedAt).toLocaleString()}</td><td><button class="sec del" data-id="${p.id}">Delete</button></td></tr>`).join('')}</table>` : '<p class="muted">No projects yet.</p>'}</div>`;
  main.querySelectorAll('.del').forEach((b) => (b.onclick = guard(async () => { if (confirm('Delete this project and its files?')) { await api('/projects/' + b.dataset.id, { method: 'DELETE' }); route(); } })));
}

async function pageProject(id) {
  let busy = false, editing = false;
  const draw = async () => {
    if (busy || editing) return; busy = true;
    try { const p = await api('/projects/' + id); renderProject(p, () => (editing = true), () => (editing = false)); if (!p.running && !['running'].includes(p.status)) clearInterval(poll); }
    finally { busy = false; }
  };
  await draw(); poll = setInterval(draw, 2500);
}

function renderProject(p, startEdit, endEdit) {
  const f = (path, dl) => `/api/projects/${p.id}/file?path=${encodeURIComponent(path)}${dl ? '&download=1' : ''}`;
  const isVideo = p.brief?.contentType === 'video'; const order = isVideo ? ['understand', 'brand', 'strategy', 'research', 'script', 'approval', 'plan', 'prompts', 'social', 'voice', 'avatar', 'visuals', 'edit', 'qc'] : p.brief ? ['understand', 'brand', 'strategy', 'research', 'copy', 'background', 'design', 'qc'] : ['understand'];
  const b = p.blocker; const keep = document.activeElement; const scrollY = scrollY_(); 
  let h = `<h2>${esc(p.script?.title || p.copy?.headline || 'Project')}</h2><p class="muted small">${esc(p.command)}</p>
  <div class="card"><div class="steps">${order.map((s) => stepPill(s, p.steps[s])).join('')}</div>
  <p class="small muted">Status: <b>${esc(p.status)}</b>${p.running ? ' — working…' : ''}</p>
  ${p.status === 'awaiting_approval' ? `<div class="banner"><b>Script ready — review it below.</b> Edit anything, then approve to continue with voice, avatar and video.<div class="row" style="margin-top:8px"><button id="approve">Approve & continue</button><input type="text" id="fb" placeholder="…or tell Gemini what to change and rewrite" style="flex:1"><button class="sec" id="rewrite">Rewrite</button></div></div>` : ''}
  ${b ? `<div class="banner ${p.status === 'failed' ? 'err' : ''}"><b>${esc(b.step)}: ${esc(b.message)}</b>${b.setup ? `<p class="small">Setup: ${esc(b.setup)}</p>` : ''}${b.kind === 'AvatarUnavailable' ? '<p class="small">No fake avatar was produced. Install an engine (docs/AVATARS.md), or switch those scenes to “visual” below and re-run.</p>' : ''}<div class="row" style="margin-top:8px">${b.kind === 'confirmation_required' ? '<button id="confirmRun">Review & confirm</button>' : ''}<button class="sec" id="retry">Retry / resume</button></div></div>` : ''}
  ${p.pendingConfirmations?.length ? `<div class="banner">${p.pendingConfirmations.length} paid generation(s) were NOT run — ${esc(p.pendingConfirmations[0].message)} <button id="confirmPaid" class="sec">Confirm &amp; generate</button></div>` : ''}</div>`;

  if (p.assets?.final && isVideo) h += `<div class="card"><h3>Final preview</h3><video class="v" controls src="${f(p.assets.final)}&t=${p.assets.finalAt}"></video><div class="row" style="margin-top:10px"><a href="${f(p.assets.final, 1)}"><button>Download MP4</button></a>${p.assets.voiceover ? `<a href="${f(p.assets.voiceover, 1)}"><button class="sec">Download voice-over (MP3)</button></a>` : ''}</div>
    ${p.social ? `<h3>Post caption</h3><pre>${esc(p.social.caption)}\n\n${esc((p.social.hashtags || []).map((x) => '#' + x).join(' '))}</pre>` : ''}</div>`;
  if (p.assets?.final && !isVideo) h += `<div class="card"><h3>Final preview</h3><img class="prev" style="max-height:620px" src="${f(p.assets.final)}&t=${p.assets.finalAt}"><div class="row" style="margin-top:10px"><a href="${f(p.assets.final, 1)}"><button>Download PNG</button></a><a href="${f(p.assets.finalJpg, 1)}"><button class="sec">Download JPG</button></a></div>${p.assets.bgNote ? `<p class="small warn">${esc(p.assets.bgNote)}</p>` : ''}<p class="small muted">Background: ${esc(p.assets.bgOrigin)}</p></div>`;
  if (p.qc) h += `<div class="card"><h3>Quality control ${p.qc.score != null ? `— ${p.qc.score}/100` : ''} <span class="pill ${p.qc.pass ? 'ok' : 'warn'}">${p.qc.pass ? 'passed' : 'needs review'}</span></h3><p>${esc(p.qc.summary)}</p>
    <ul class="small">${(p.qc.checks || []).map((c) => `<li class="${c.ok ? 'ok' : 'bad-t'}">${c.ok ? '✓' : '✗'} ${esc(c.name)} <span class="muted">(${esc(c.detail)})</span></li>`).join('')}</ul>
    ${(p.qc.issues || []).map((i) => `<p class="small"><span class="pill ${i.severity === 'high' ? 'err' : 'warn'}">${esc(i.severity)}</span> <b>${esc(i.where)}</b>: ${esc(i.problem)} <span class="muted">→ ${esc(i.fix)}</span></p>`).join('')}</div>`;

  if (isVideo && p.script) {
    h += `<div class="card"><h3>Script &amp; scenes</h3><p class="small muted">Edit any scene; only the changed scene is re-voiced / re-rendered.</p><div id="scenes">` +
      p.script.scenes.map((s, i) => {
        const a = p.assets?.scenes?.[s.id] || {}; const pl = p.plan?.scenes?.[i] || {};
        return `<div class="scene" data-id="${s.id}">
        <div class="row"><b>${i + 1}.</b>
          <div class="col"><label>Type</label><select class="k"><option value="avatar" ${s.kind === 'avatar' ? 'selected' : ''}>Avatar</option><option value="visual" ${s.kind === 'visual' ? 'selected' : ''}>Visual</option><option value="avatar_pip" ${s.kind === 'avatar_pip' ? 'selected' : ''}>Visual + avatar inset</option></select></div>
          ${p.plan ? `<div class="col"><label>Motion</label><select class="m">${['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static'].map((x) => `<option ${pl.motion === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="col"><label>Transition in</label><select class="t">${['fade', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'circleopen', 'dissolve'].map((x) => `<option ${pl.transition === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>` : ''}
        </div>
        <label>Narration</label><textarea class="n" style="min-height:60px">${esc(s.narration)}</textarea>
        <label>On-screen text</label><input type="text" class="o" value="${esc(s.onScreenText)}">
        ${a.audio ? `<label>Voice</label><audio controls src="${f(a.audio)}&h=${a.audioHash}"></audio>` : ''}
        ${a.avatarVideo ? `<label>Avatar (${esc(a.avatarProvider)}, motion ${(a.avatarMotion ?? 0).toFixed(2)})</label><video controls height="220" src="${f(a.avatarVideo)}&h=${a.avatarHash}"></video>` : ''}
        ${a.visual ? `<p class="small muted">Visual: ${esc(a.visual.origin)}${a.visual.note ? ' — ' + esc(a.visual.note) : ''}</p>` : ''}
        ${p.plan ? `<p class="small muted">Plan: ${esc(pl.visualDescription || '')}</p>` : ''}
        ${a.audio ? `<div class="row small"><button class="sec rg" data-part="audio">Re-voice</button>${a.avatarVideo || s.kind !== 'visual' ? '<button class="sec rg" data-part="avatar">Regenerate avatar</button>' : ''}${s.kind !== 'avatar' ? '<button class="sec rg" data-part="visual">Regenerate visual</button>' : ''}<button class="sec rg" data-part="render">Re-render scene</button></div>` : ''}
      </div>`; }).join('') + `</div><div class="row"><button id="save">Save script edits</button><button class="sec" id="rerun">Save &amp; re-run affected parts</button></div></div>`;
    h += `<div class="card"><h3>Change avatar, voice or look <span class="small muted">(script is not rewritten)</span></h3><div id="chg"></div></div>`;
  }
  if (!isVideo && p.copy) h += `<div class="card"><h3>Copy</h3>${['headline', 'subhead', 'body', 'cta'].map((k) => `<label>${k}</label><input type="text" class="cp" data-k="${k}" value="${esc(p.copy[k])}">`).join('')}<div class="row" style="margin-top:10px"><button id="savecopy">Save &amp; re-design</button></div></div>`;
  h += `<div class="card"><details><summary class="small">Agents &amp; revisions</summary><pre>${esc(p.agentLog.map((a) => `${a.agent} → ${a.model} (${a.tokens ?? '?'} tokens)`).join('\n'))}\n\n${esc(p.revisions.map((r) => r.at + ' ' + r.what).join('\n'))}</pre></details></div>`;

  main.innerHTML = h; scrollTo(0, scrollY);
  const run = guard(async (json) => { await api(`/projects/${p.id}/run`, { json }); route(); });
  $('#approve')?.addEventListener('click', guard(async () => { await api(`/projects/${p.id}/approve`, { method: 'POST' }); route(); }));
  $('#rewrite')?.addEventListener('click', guard(async () => { await api(`/projects/${p.id}/revise-script`, { json: { feedback: $('#fb').value } }); route(); }));
  $('#retry')?.addEventListener('click', () => run({}));
  const confirmFlow = guard(async () => { const est = (await api('/projects/' + p.id)).estimate; if (await confirmCost(est)) run({ confirm: { paid: true, externalAvatar: true } }); });
  $('#confirmRun')?.addEventListener('click', confirmFlow); $('#confirmPaid')?.addEventListener('click', confirmFlow);
  main.querySelectorAll('textarea,input,select').forEach((e) => { e.addEventListener('focus', startEdit); e.addEventListener('input', startEdit); });
  const collect = () => ({ scenes: [...main.querySelectorAll('.scene')].map((e) => ({ id: e.dataset.id, kind: $('.k', e).value, narration: $('.n', e).value, onScreenText: $('.o', e).value })) });
  const collectPlan = () => ({ scenes: [...main.querySelectorAll('.scene')].filter((e) => $('.m', e)).map((e) => ({ id: e.dataset.id, motion: $('.m', e).value, transition: $('.t', e).value })) });
  const save = async () => { await api('/projects/' + p.id, { method: 'PATCH', json: { script: collect(), plan: p.plan ? collectPlan() : undefined } }); endEdit(); };
  $('#save')?.addEventListener('click', guard(async () => { await save(); toast('Saved'); route(); }));
  $('#rerun')?.addEventListener('click', guard(async () => { await save(); await api(`/projects/${p.id}/run`, { json: {} }); route(); }));
  main.querySelectorAll('.rg').forEach((bn) => (bn.onclick = guard(async () => { const sid = bn.closest('.scene').dataset.id; await api(`/projects/${p.id}/scenes/${sid}/regenerate`, { json: { part: bn.dataset.part } }); route(); })));
  $('#savecopy')?.addEventListener('click', guard(async () => { const copy = Object.fromEntries([...main.querySelectorAll('.cp')].map((e) => [e.dataset.k, e.value])); await api('/projects/' + p.id, { method: 'PATCH', json: { copy } }); await api(`/projects/${p.id}/run`, { json: {} }); endEdit(); route(); }));
  if ($('#chg')) drawChange(p, endEdit);
}
const scrollY_ = () => window.scrollY;

async function drawChange(p, endEdit) {
  const [av, voices] = await Promise.all([api('/avatars'), api('/voices')]); const o = p.options; let mode = o.avatarMode, id = o.avatarId;
  const box = $('#chg');
  const d = () => {
    box.innerHTML = `<div class="row"><div class="col"><label>Avatar mode</label><select id="cm"><option value="none">None</option><option value="preset">Ready-made</option><option value="photo">My photo</option></select></div>
      <div class="col"><label>Background</label><select id="cb">${bgOptions(av, o.avatarBg.backgroundId)}</select></div>
      <div class="col"><label>Music</label><select id="cmu"><option value="none" ${o.music === 'none' ? 'selected' : ''}>None</option><option value="ambient" ${o.music === 'ambient' ? 'selected' : ''}>Ambient</option></select></div>
      <div class="col"><label>Quality</label><select id="cq"><option ${o.quality === 'draft' ? 'selected' : ''}>draft</option><option ${o.quality === 'final' ? 'selected' : ''}>final</option></select></div>
      <div class="col"><label>Voice</label><select id="cv">${voices.voices.map((v) => `<option ${v.name === o.voice.voice ? 'selected' : ''}>${v.name}</option>`).join('')}</select></div></div>
      ${mode === 'preset' ? avatarPicker(av, id) : mode === 'photo' ? `<div class="grid">${av.photos.map((x) => `<div class="av ${id === x.id ? 'sel' : ''}" data-av="${x.id}"><img src="${x.url}"><b>${esc(x.name)}</b></div>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:10px"><button id="apply">Apply &amp; re-render</button><span class="small muted">Changing the voice re-voices every scene (to keep one consistent voice).</span></div>`;
    $('#cm').value = mode; $('#cm').onchange = (e) => { mode = e.target.value; id = null; d(); };
    box.querySelectorAll('[data-av]').forEach((e) => (e.onclick = () => { id = e.dataset.av; d(); }));
    $('#apply').onclick = guard(async () => {
      if (mode !== 'none' && !id) throw new Error('Choose an avatar first.');
      const options = { avatarMode: mode, avatarId: id, avatarBg: { backgroundId: $('#cb').value }, music: $('#cmu').value, quality: $('#cq').value };
      if ($('#cv').value !== o.voice.voice) options.voice = { voice: $('#cv').value };
      await api('/projects/' + p.id, { method: 'PATCH', json: { options } });
      await api(`/projects/${p.id}/run`, { json: {} }); location.hash = '#/project/' + p.id; route();
    });
  };
  d();
}

// ---------- AVATARS ----------
async function pageAvatars() {
  const av = await api('/avatars'); let tab = 'preset', filter = { gender: '', style: '' }, sel = null;
  const draw = () => {
    const list = av.presets.filter((p) => (!filter.gender || p.gender === filter.gender) && (!filter.style || p.style === filter.style));
    main.innerHTML = `<h2>Avatars</h2><div class="tabs"><button data-t="preset" class="${tab === 'preset' ? 'on' : ''}">Mode 1 · Ready-made presenters</button><button data-t="photo" class="${tab === 'photo' ? 'on' : ''}">Mode 2 · My own photo</button><button data-t="engines" class="${tab === 'engines' ? 'on' : ''}">Engines</button></div>
    <div id="tab"></div>`;
    main.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    const t = $('#tab');
    if (tab === 'preset') {
      t.innerHTML = `<div class="card"><div class="row"><div class="col"><label>Gender</label><select id="fg"><option value="">All</option><option>female</option><option>male</option></select></div><div class="col"><label>Style</label><select id="fs"><option value="">All</option>${['professional', 'friendly', 'influencer', 'presenter'].map((s) => `<option>${s}</option>`).join('')}</select></div></div>
      <p class="small muted" style="margin-top:10px">These are illustrated vector presenters (image generation isn't available on a free-tier key). They are the source image for the lip-sync engine; no animation exists until an engine in the “Engines” tab is installed.</p>
      <div class="grid">${list.map((p) => `<div class="av ${prefs.get().avatarId === p.id ? 'sel' : ''}" data-av="${p.id}"><img src="/api/avatars/preset/${p.id}.png"><b>${esc(p.name)}</b><span class="small muted">${esc(p.gender)} · ${esc(p.style)}</span></div>`).join('')}</div></div>
      <div class="card"><h3>Backgrounds</h3><div class="row">${av.backgrounds.map((b) => `<div style="width:90px;height:60px;border-radius:8px;background:linear-gradient(135deg,${b.colors.primary},${b.colors.secondary})" title="${esc(b.label)}"></div>`).join('')}</div><p class="small muted">Backgrounds replace the presenter's green key colour. Custom image/video backgrounds can be uploaded on the Library page.</p></div>`;
      $('#fg').value = filter.gender; $('#fs').value = filter.style; $('#fg').onchange = (e) => { filter.gender = e.target.value; draw(); }; $('#fs').onchange = (e) => { filter.style = e.target.value; draw(); };
      t.querySelectorAll('[data-av]').forEach((e) => (e.onclick = () => { const p = av.presets.find((x) => x.id === e.dataset.av); modal(`<h3>${esc(p.name)} — ${esc(p.style)}</h3><img src="/api/avatars/preset/${p.id}.png" style="width:100%;border-radius:10px"><p class="muted">${esc(p.blurb)}</p><div class="row"><button id="use">Use as default presenter</button><button class="sec" onclick="document.getElementById('modal').hidden=true">Close</button></div>`); $('#use').onclick = () => { prefs.set({ avatarMode: 'preset', avatarId: p.id }); closeModal(); toast(p.name + ' set as default'); draw(); }; }));
    } else if (tab === 'photo') {
      t.innerHTML = `<div class="card"><h3>Upload a photo</h3><p class="small muted">Use a clear, front-facing photo of one person with a plain background if you want to swap the background. The original is stored read-only; a separate prepared copy is used for generation.</p>
        <input type="file" id="file" accept="image/*"><div id="prev" style="margin:10px 0"></div>
        <label><input type="checkbox" id="consent"> I confirm that I own this photo or have the person's permission to use it to create a talking avatar.</label>
        <div class="row" style="margin-top:10px"><button id="up" disabled>Upload</button></div></div>
        <div class="card"><h3>My photos</h3>${av.photos.length ? `<div class="grid">${av.photos.map((p) => `<div class="av"><img src="${p.url}"><b>${esc(p.name)}</b><span class="small muted">${p.meta.backdrop?.plain ? 'plain backdrop ' + esc(p.meta.backdrop.color) : 'busy backdrop'}</span><div class="row small" style="justify-content:center;margin-top:6px"><button class="sec iso" data-id="${p.id}">Remove bg</button><button class="sec del" data-id="${p.id}">Delete</button></div></div>`).join('')}</div>` : '<p class="muted">None yet.</p>'}
        <p class="small muted">Background replacement: ${av.rembg ? 'AI cut-out available (rembg).' : 'AI cut-out (rembg) is not installed — colour-key works only on photos with a plain backdrop.'}</p></div>`;
      const file = $('#file'), upBtn = $('#up'), chk = $('#consent'); const upd = () => (upBtn.disabled = !(file.files[0] && chk.checked));
      file.onchange = () => { const f = file.files[0]; $('#prev').innerHTML = f ? `<img class="prev" style="max-height:260px" src="${URL.createObjectURL(f)}">` : ''; upd(); }; chk.onchange = upd;
      upBtn.onclick = guard(async () => { const fd = new FormData(); fd.append('photo', file.files[0]); fd.append('consent', 'true'); await api('/photos', { method: 'POST', body: fd }); toast('Uploaded'); route(); });
      t.querySelectorAll('.del').forEach((b) => (b.onclick = guard(async () => { if (confirm('Delete this photo and its derived files?')) { await api('/library/' + b.dataset.id, { method: 'DELETE' }); route(); } })));
      t.querySelectorAll('.iso').forEach((b) => (b.onclick = guard(async () => { await api(`/photos/${b.dataset.id}/isolate`, { method: 'POST' }); toast('Background removed'); route(); })));
    } else {
      t.innerHTML = av.providers.map((p) => `<div class="card"><div class="row"><b>${esc(p.label)}</b><span class="pill ${p.ready ? 'ok' : 'err'}">${p.ready ? 'ready' : 'not installed'}</span><span class="pill">${esc(p.kind)}</span></div><p class="small">${esc(p.description)}</p><p class="small muted">Lip-sync ${p.capabilities.lipSync ? '✓' : '✗'} · facial animation ${p.capabilities.facialAnimation ? '✓' : '✗'} · head motion ${p.capabilities.headMotion ? '✓' : '✗'}</p>${p.ready ? '' : `<p class="small warn">${esc(p.reason)}</p><p class="small muted">${esc(p.setup)}</p>`}</div>`).join('') + '<p class="small muted">Until an engine is ready, avatar scenes stop with a clear message — a still image is never presented as a talking avatar.</p>';
    }
  };
  draw();
}

// ---------- VOICE ----------
async function pageVoice() {
  const v = await api('/voices'); const pr = prefs.get(); let g = '';
  main.innerHTML = `<h2>Voice</h2><div class="card"><div class="row">
    <div class="col"><label>Language</label><select id="l">${v.languages.map((l) => `<option value="${l.code}" ${l.code === (pr.lang || 'en-IN') ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select></div>
    <div class="col"><label>Tone</label><select id="t">${v.tones.map((t) => `<option ${t === (pr.tone || 'neutral') ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="col"><label>Speed</label><input id="s" type="number" min="0.7" max="1.4" step="0.05" value="${pr.speed || 1}" style="width:80px"></div>
    <div class="col"><label>Voice</label><select id="g"><option value="">All</option><option>female</option><option>male</option></select></div></div>
    <label style="margin-top:10px;display:block">Sample text (optional)</label><textarea id="x" placeholder="Leave empty for a default sample in the chosen language"></textarea>
    <p class="small muted">${esc(v.note)}</p><div id="vg" class="grid" style="margin-top:10px"></div><audio id="au" controls style="margin-top:12px"></audio>
    <div class="row" style="margin-top:10px"><a id="dl" hidden><button class="sec">Download this audio</button></a></div></div>`;
  const draw = () => { $('#vg').innerHTML = v.voices.filter((x) => !g || x.presentation === g).map((x) => `<div class="av ${pr.voice === x.name ? 'sel' : ''}" data-v="${x.name}"><b>${x.name}</b><span class="small muted">${x.presentation} · ${x.style}</span><div class="row small" style="justify-content:center;margin-top:6px"><button class="sec pv">▶ Preview</button><button class="sec us">Use</button></div></div>`).join(''); bind(); };
  const bind = () => document.querySelectorAll('#vg .av').forEach((e) => {
    $('.pv', e).onclick = guard(async () => {
      const btn = $('.pv', e); btn.disabled = true; btn.textContent = '…';
      try { const body = { voice: e.dataset.v, language: $('#l').value, tone: $('#t').value, speed: Number($('#s').value) || 1, sample: $('#x').value || undefined };
        const r = await fetch('/api/voices/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error((await r.json()).error);
        const url = URL.createObjectURL(await r.blob()); const au = $('#au'); au.src = url; au.play(); const dl = $('#dl'); dl.href = url; dl.download = `${e.dataset.v}.wav`; dl.hidden = false;
      } finally { btn.disabled = false; btn.textContent = '▶ Preview'; } });
    $('.us', e).onclick = () => { prefs.set({ voice: e.dataset.v, lang: $('#l').value, tone: $('#t').value, speed: Number($('#s').value) || 1 }); pr.voice = e.dataset.v; toast(e.dataset.v + ' set as default voice'); draw(); };
  });
  $('#g').onchange = (e) => { g = e.target.value; draw(); }; draw();
}

// ---------- LIBRARY ----------
async function pageLibrary() {
  const items = await api('/library');
  main.innerHTML = `<h2>Library</h2><div class="card"><h3>Add media</h3><div class="row"><div class="col"><label>Type</label><select id="k"><option value="image">Image (visual scenes)</option><option value="clip">Video clip (visual scenes)</option><option value="music">Music</option><option value="logo">Brand logo</option><option value="background">Avatar background</option></select></div><input type="file" id="f"><label><input type="checkbox" id="r"> I have the rights to use this media</label><button id="u">Upload</button></div></div>
  <div class="card">${items.length ? `<div class="grid">${items.map((a) => `<div class="av"><div style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:8px;background:#000">${a.mime?.startsWith('image') || a.kind.startsWith('photo') ? `<img src="${a.url}" style="width:100%;height:100%;object-fit:cover">` : a.mime?.startsWith('video') ? `<video src="${a.url}" muted style="width:100%"></video>` : '♪'}</div><b class="small">${esc(a.name)}</b><span class="pill">${esc(a.kind)}</span>${a.kind === 'photo-original' ? '' : `<div><button class="sec del small" data-id="${a.id}">Delete</button></div>`}</div>`).join('')}</div>` : '<p class="muted">Empty.</p>'}</div>`;
  $('#u').onclick = guard(async () => { const fd = new FormData(); fd.append('file', $('#f').files[0]); fd.append('kind', $('#k').value); fd.append('rights', $('#r').checked); await api('/library/upload', { method: 'POST', body: fd }); route(); });
  main.querySelectorAll('.del').forEach((b) => (b.onclick = guard(async () => { await api('/library/' + b.dataset.id, { method: 'DELETE' }); route(); })));
}

// ---------- BRAND ----------
async function pageBrand() {
  const b = await api('/brand'); const logos = (await api('/library?kind=logo'));
  const fld = (k, l, t = 'text') => `<div class="col" style="flex:1;min-width:220px"><label>${l}</label><input type="${t}" id="b_${k}" value="${esc(b[k])}"></div>`;
  main.innerHTML = `<h2>Brand profile</h2><p class="muted small">Retrieved and applied by every agent and by image/video design.</p><div class="card"><div class="row">${fld('name', 'Brand name')}${fld('industry', 'Industry')}${fld('audience', 'Audience')}${fld('tagline', 'Tagline')}</div>
  <div class="row" style="margin-top:10px">${fld('voice', 'Brand voice')}${fld('dos', 'Always')}${fld('donts', 'Never')}</div>
  <div class="row" style="margin-top:10px">${['primary', 'secondary', 'accent'].map((c) => `<div class="col"><label>${c}</label><input type="color" id="c_${c}" value="${b.colors[c]}"></div>`).join('')}
  <div class="col"><label>Logo (upload in Library as “logo”)</label><select id="logo"><option value="">None</option>${logos.map((l) => `<option value="${l.id}" ${b.logoAssetId === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div></div>
  <div style="margin-top:14px"><button id="sv">Save brand</button></div></div>`;
  $('#sv').onclick = guard(async () => { const j = { logoAssetId: $('#logo').value || null, colors: Object.fromEntries(['primary', 'secondary', 'accent'].map((c) => [c, $('#c_' + c).value])) }; for (const k of ['name', 'industry', 'audience', 'tagline', 'voice', 'dos', 'donts']) j[k] = $('#b_' + k).value; await api('/brand', { method: 'PUT', json: j }); toast('Saved'); });
}

// ---------- API SETTINGS ----------
async function pageSettings() {
  const d = await api('/settings'); const s = d.settings; const u = d.usageToday;
  const caps = d.capabilities || {};
  const statusPill = (st) => { const x = st?.status; const cls = x === 'free_ok' || x === 'paid_ok' || x === 'ok' ? 'ok' : x === 'needs_billing' || x === 'quota_exhausted' ? 'err' : ''; const label = { free_ok: 'works', paid_ok: 'works (paid)', needs_billing: 'needs billing (quota 0)', quota_exhausted: 'daily quota used up', unverified: 'not checked' }[x] || x || '—'; return `<span class="pill ${cls}">${label}</span>`; };
  main.innerHTML = `<h2>API Settings</h2>
  <div class="card"><h3>Connection</h3><p>Gemini API key: ${d.keyConfigured ? '<span class="ok">configured on the server</span>' : '<span class="bad-t">missing</span>'} <span class="small muted">— it lives in the server's <code>.env</code> and is never sent to the browser.</span></p>
    <div class="row"><button id="test">Test connection</button></div><div id="tr"></div></div>
  <div class="card"><h3>Model availability <span class="small muted">(${fmt(d.modelCount)} models visible to this key)</span></h3>${d.modelError ? `<p class="bad-t">${esc(d.modelError)}</p>` : ''}
    <table><tr><th>Capability</th><th>Selected model</th><th>Status</th><th>Other available</th><th></th></tr>${Object.entries(caps).map(([k, c]) => `<tr><td><b>${k}</b> ${c.paidClass ? '<span class="pill warn">paid-class</span>' : '<span class="pill ok">free-tier class</span>'}</td><td>${esc(c.model || 'none available')}</td><td>${statusPill(c.status)}</td><td class="small muted">${esc((c.available || []).filter((x) => x !== c.model).join(', '))}${c.blocked?.length ? `<br>unusable now: ${esc(c.blocked.join(', '))}` : ''}</td><td><button class="sec chk" data-k="${k}" data-paid="${c.paidClass}">Check</button></td></tr>`).join('')}</table>
    <p class="small muted">“Check” makes one tiny real call. For paid-class capabilities it asks for confirmation first, since on a billed plan it would cost money.</p></div>
  <div class="card"><h3>Usage today (counted locally)</h3><p class="small muted">Google does not expose remaining quota to API keys, so this counts the requests this app sent. Quota errors from Google (daily limits, quota 0) are detected and remembered.</p>
    <table><tr><th>Kind</th><th>Requests</th><th>Errors</th><th>Daily cap</th><th></th></tr>${Object.keys(s.limits).map((k) => { const x = u.kinds[k] || { requests: 0, errors: 0 }; const pct = s.limits[k] ? Math.min(100, (x.requests / s.limits[k]) * 100) : 0; return `<tr><td>${k}</td><td>${x.requests}</td><td>${x.errors}</td><td>${s.limits[k]}</td><td style="width:30%"><div class="bar"><i style="width:${pct}%"></i></div></td></tr>`; }).join('')}</table>
    <table style="margin-top:10px"><tr><th>Model</th><th>Requests</th><th>Prompt tokens</th><th>Output tokens</th></tr>${Object.entries(u.models).map(([m, x]) => `<tr><td>${esc(m)}</td><td>${x.requests}</td><td>${fmt(x.promptTokens)}</td><td>${fmt(x.outputTokens)}</td></tr>`).join('') || '<tr><td colspan=4 class="muted">no calls yet today</td></tr>'}</table>
    <p class="small">Estimated paid spend today: <b>$${(u.estPaidUsd || 0).toFixed(2)}</b></p></div>
  <div class="card"><h3>Limits &amp; paid-generation policy</h3>
    <div class="banner"><label style="color:inherit"><input type="checkbox" id="ap" ${s.allowPaid ? 'checked' : ''}> <b>Allow paid generation</b> (images, Omni video, music). Even when on, every paid call needs a price below, fits the daily ceiling, and is confirmed by you each time.</label></div>
    <div class="row">${Object.keys(s.limits).map((k) => `<div class="col"><label>${k} / day</label><input type="number" min="0" id="l_${k}" value="${s.limits[k]}" style="width:90px"></div>`).join('')}<div class="col"><label>Max est. paid $ / day</label><input type="number" min="0" step="0.5" id="mx" value="${s.maxPaidUsdPerDay}" style="width:110px"></div></div>
    <div class="row" style="margin-top:10px"><label><input type="checkbox" id="ra" ${s.requireScriptApproval ? 'checked' : ''}> Require script approval by default</label><label><input type="checkbox" id="gr" ${s.grounding ? 'checked' : ''}> Research agent uses Google Search grounding (may be billed separately)</label></div>
    <h3>Price list <span class="small muted">(copy current prices from ai.google.dev/pricing — none are assumed)</span></h3>
    <div class="row">${Object.entries(d.rates).map(([k, r]) => `<div class="col"><label>${k} — USD ${esc(r.unit)}</label><input type="number" step="0.001" min="0" id="r_${k}" value="${r.usd ?? ''}" placeholder="not set" style="width:130px"></div>`).join('')}</div>
    <div style="margin-top:12px"><button id="sv">Save</button></div></div>
  <div class="card"><h3>Error handling</h3><ul class="small"><li>Rate limits and 5xx errors are retried with exponential backoff (honouring Google's retry delay).</li><li>Overloaded or daily-exhausted text models fall through to the next free Gemini text model.</li><li>“Quota 0” (paid-only) models are detected, remembered, and never retried.</li><li>TTS keeps one model and voice per project so the voice never changes mid-video.</li></ul></div>`;
  $('#test').onclick = guard(async () => { $('#tr').innerHTML = '<p class="muted">Testing…</p>'; const r = await api('/connection-test', { method: 'POST' }); $('#tr').innerHTML = `<ul>${r.steps.map((x) => `<li class="${x.ok ? 'ok' : 'bad-t'}">${x.ok ? '✓' : '✗'} ${esc(x.name)} — <span class="muted">${esc(x.detail)}</span></li>`).join('')}</ul>`; });
  main.querySelectorAll('.chk').forEach((b) => (b.onclick = guard(async () => {
    let confirm = false;
    if (b.dataset.paid === 'true') { confirm = window.confirm('This makes one tiny real request to a PAID-class model. On a billed plan it may cost a few cents; on the free tier it just returns “quota 0”. Continue?'); if (!confirm) return; }
    b.disabled = true; b.textContent = '…'; const r = await api('/models/check', { json: { kind: b.dataset.k, confirm } }); toast(`${b.dataset.k}: ${r.status}${r.detail ? ' — ' + r.detail.slice(0, 160) : ''}`, r.status !== 'ok'); route();
  })));
  $('#sv').onclick = guard(async () => {
    await api('/settings', { method: 'PUT', json: { allowPaid: $('#ap').checked, requireScriptApproval: $('#ra').checked, grounding: $('#gr').checked, maxPaidUsdPerDay: Number($('#mx').value) || 0, limits: Object.fromEntries(Object.keys(s.limits).map((k) => [k, Number($('#l_' + k).value) || 0])) } });
    await api('/pricing', { method: 'PUT', json: Object.fromEntries(Object.keys(d.rates).map((k) => [k, { usd: $('#r_' + k).value }])) }); toast('Saved'); route();
  });
}
route();
