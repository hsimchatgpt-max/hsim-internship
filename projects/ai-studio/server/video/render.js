import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg, probe } from '../lib/util.js';
import { buildAss, FONTS_DIR } from './captions.js';

export const FPS = 30;
export const TAIL = 0.5; // silence after speech so transitions never clip words
export const HEAD = 0.15;

export function dims(aspect, quality = 'final') {
  const base = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] }[aspect] || [1080, 1920];
  if (quality === 'draft') return base.map((v) => Math.round(v / 2 / 2) * 2);
  return base;
}

const escFilterPath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
const subs = (ass) => `ass='${escFilterPath(ass)}':fontsdir='${escFilterPath(FONTS_DIR)}':shaping=complex`;
const AUDIO_OUT = ['-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2'];
const VIDEO_OUT = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart'];

/** Pad the narration so the scene has a head and a tail of silence. Returns scene duration. */
export async function sceneAudio(wav, out) {
  const info = await probe(wav);
  const dur = info.duration + HEAD + TAIL;
  await ffmpeg(['-i', wav, '-af', `adelay=${Math.round(HEAD * 1000)}|${Math.round(HEAD * 1000)},apad=whole_dur=${dur.toFixed(3)}`, '-ac', '2', '-ar', '44100', out]);
  return { file: out, duration: dur, speechStart: HEAD, speechEnd: HEAD + info.duration };
}

/** Local procedural background (NOT AI): slowly drifting brand gradient. Used when no media is available. */
function gradientInput(w, h, dur, colors, seedIdx) {
  const [c0, c1, c2] = [colors.primary || '#1f7a3d', colors.secondary || '#0b3d2e', colors.accent || '#ff9f1c'];
  const flip = seedIdx % 2 === 0;
  return ['-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=${(flip ? c0 : c1).replace('#', '0x')}:c1=${(flip ? c1 : c2).replace('#', '0x')}:x0=0:y0=0:x1=${w}:y1=${h}:speed=0.015:d=${dur.toFixed(2)}:r=${FPS}`];
}

function zoompanExpr(motion, frames) {
  const z = { zoom_in: `z='min(1+0.12*on/${frames},1.12)'`, zoom_out: `z='max(1.12-0.12*on/${frames},1.0)'`, pan_left: `z='1.1'`, pan_right: `z='1.1'`, static: `z='1.0'` }[motion] || `z='1.0'`;
  const x = { pan_left: `x='(iw-iw/zoom)*(1-on/${frames})'`, pan_right: `x='(iw-iw/zoom)*on/${frames}'` }[motion] || `x='iw/2-(iw/zoom/2)'`;
  return `${z}:${x}:y='ih/2-(ih/zoom/2)'`;
}

/**
 * Render one VISUAL scene to an mp4 with its narration and burned-in animated captions.
 * source: {type:'image'|'clip'|'gradient', file?}
 */
export async function renderVisualScene({ source, audio, w, h, narration, headline, motion = 'zoom_in', colors, accent, idx = 0, out, workDir, captionsOn = true, overlayAvatar }) {
  fs.mkdirSync(workDir, { recursive: true });
  const ass = buildAss({ file: path.join(workDir, `s${idx}.ass`), width: w, height: h, narration, headline, speechStart: audio.speechStart, speechEnd: audio.speechEnd, sceneDuration: audio.duration, accent, captionsOn });
  const frames = Math.ceil(audio.duration * FPS);
  let input, base;
  if (source.type === 'image') {
    input = ['-loop', '1', '-framerate', String(FPS), '-t', audio.duration.toFixed(3), '-i', source.file];
    base = `[0:v]scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},zoompan=${zoompanExpr(motion, frames)}:d=1:s=${w}x${h}:fps=${FPS},format=yuv420p`;
  } else if (source.type === 'clip') {
    input = ['-stream_loop', '-1', '-t', audio.duration.toFixed(3), '-i', source.file];
    base = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${FPS},format=yuv420p`;
  } else {
    input = gradientInput(w, h, audio.duration, colors || {}, idx);
    base = `[0:v]format=yuv420p,vignette=PI/5`;
  }
  const audioIdx = overlayAvatar ? 2 : 1;
  const args = [...input];
  let graph;
  if (overlayAvatar) {
    // avatar picture-in-picture: lower-right inset, rounded feel via simple crop; its audio is NOT used (the narration is)
    args.push('-i', overlayAvatar.file);
    const pw = Math.round(w * 0.42);
    graph = `${base}[bg];[1:v]scale=${pw}:-2,format=yuva420p[pip];[bg][pip]overlay=W-w-${Math.round(w * 0.04)}:H-h-${Math.round(h * 0.2)}:shortest=0[v0];[v0]${subs(ass)}[v]`;
  } else {
    graph = `${base}[v0];[v0]${subs(ass)}[v]`;
  }
  args.push('-i', audio.file, '-filter_complex', graph, '-map', '[v]', '-map', `${audioIdx}:a`, '-t', audio.duration.toFixed(3), ...VIDEO_OUT, ...AUDIO_OUT, out);
  await ffmpeg(args, { cwd: workDir });
  return { file: out, duration: audio.duration };
}

/**
 * Render one AVATAR scene from a lip-synced avatar video produced by an avatar provider.
 * bg: {type:'none'|'image'|'gradient'|'clip', file?, keyColor?, similarity?} — if keyColor is given the avatar's
 * flat background colour is keyed out and replaced; otherwise the avatar video is shown as-is (cover-fit).
 */
export async function renderAvatarScene({ avatarVideo, audio, w, h, narration, headline, bg = { type: 'none' }, colors, accent, idx = 0, out, workDir, captionsOn = true }) {
  fs.mkdirSync(workDir, { recursive: true });
  const ass = buildAss({ file: path.join(workDir, `s${idx}.ass`), width: w, height: h, narration, headline, speechStart: audio.speechStart, speechEnd: audio.speechEnd, sceneDuration: audio.duration, accent, captionsOn });
  const dur = audio.duration;
  const args = [];
  let bgGraph;
  if (bg.type === 'image') { args.push('-loop', '1', '-framerate', String(FPS), '-t', dur.toFixed(3), '-i', bg.file); bgGraph = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},format=yuv420p[bg]`; }
  else if (bg.type === 'clip') { args.push('-stream_loop', '-1', '-t', dur.toFixed(3), '-i', bg.file); bgGraph = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${FPS},format=yuv420p[bg]`; }
  else { args.push(...gradientInput(w, h, dur, colors || {}, idx)); bgGraph = `[0:v]format=yuv420p[bg]`; }
  args.push('-i', avatarVideo, '-i', audio.file);
  // Avatar fills the frame width, anchored at the bottom. The (possibly keyed) avatar is padded/looped to scene length.
  const key = bg.keyColor
    ? `,colorkey=${bg.keyColor.replace('#', '0x')}:${bg.similarity ?? 0.28}:0.08,format=yuva420p`
    : ',format=yuva420p';
  const graph = `${bgGraph};[1:v]tpad=stop_mode=clone:stop_duration=${TAIL + 1},scale=${w}:-2${key}[av];[bg][av]overlay=0:H-h:shortest=1[v0];[v0]${subs(ass)}[v]`;
  args.push('-filter_complex', graph, '-map', '[v]', '-map', '2:a', '-t', dur.toFixed(3), ...VIDEO_OUT, ...AUDIO_OUT, out);
  await ffmpeg(args, { cwd: workDir });
  return { file: out, duration: dur };
}

/** Locally synthesised ambient pad (not licensed music, not AI): a soft chord with slow tremolo. */
export async function synthAmbientBed(out, seconds) {
  const chord = [110, 138.59, 164.81, 220].map((f, i) => `0.18*sin(2*PI*${f}*t)*(0.7+0.3*sin(2*PI*${0.07 + i * 0.03}*t))`).join('+');
  await ffmpeg(['-f', 'lavfi', '-i', `aevalsrc='${chord}':s=44100:d=${seconds.toFixed(2)}:c=stereo`, '-af', 'lowpass=f=900,afade=t=in:d=2,afade=t=out:st=' + Math.max(0, seconds - 2).toFixed(2) + ':d=2', out]);
  return out;
}

export const TRANSITION_DUR = 0.4;

/** xfade/acrossfade the scene clips together, then optionally mix music with ducking under the narration. */
export async function assemble({ scenes, transitions = [], music, musicVolume = 0.14, out, workDir }) {
  fs.mkdirSync(workDir, { recursive: true });
  const n = scenes.length;
  const args = scenes.flatMap((s) => ['-i', s.file]);
  const parts = [];
  let vLabel = '[0:v]', aLabel = '[0:a]', acc = scenes[0].duration;
  for (let i = 1; i < n; i++) {
    const tr = transitions[i - 1] || 'fade';
    const off = (acc - TRANSITION_DUR).toFixed(3);
    parts.push(`${vLabel}[${i}:v]xfade=transition=${tr}:duration=${TRANSITION_DUR}:offset=${off}[v${i}]`);
    parts.push(`${aLabel}[${i}:a]acrossfade=d=${TRANSITION_DUR}[a${i}]`);
    vLabel = `[v${i}]`; aLabel = `[a${i}]`;
    acc += scenes[i].duration - TRANSITION_DUR;
  }
  if (n === 1) { parts.push('[0:v]null[vout]', '[0:a]anull[aout0]'); vLabel = '[vout]'; aLabel = '[aout0]'; }
  else { parts.push(`${vLabel}null[vout]`, `${aLabel}anull[aout0]`); }
  let finalA = '[aout0]';
  if (music) {
    args.push('-stream_loop', '-1', '-i', music);
    // music is ducked whenever narration is present
    parts.push(`[aout0]asplit=2[nar][key]`, `[${n}:a]volume=${musicVolume},aformat=channel_layouts=stereo[mus]`, `[mus][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[duck]`, `[nar][duck]amix=inputs=2:duration=first:normalize=0[aout]`);
    finalA = '[aout]';
  }
  args.push('-filter_complex', parts.join(';'), '-map', '[vout]', '-map', finalA, ...VIDEO_OUT, ...AUDIO_OUT, '-t', acc.toFixed(3), out);
  await ffmpeg(args, { cwd: workDir });
  return { file: out, duration: acc };
}

/** Extract n evenly spaced JPEG frames (base64) for the multimodal QC agent. */
export async function sampleFrames(video, n = 3, workDir) {
  const info = await probe(video);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (info.duration * (i + 0.5)) / n;
    const f = path.join(workDir, `qc${i}.jpg`);
    await ffmpeg(['-ss', t.toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', f]);
    out.push(fs.readFileSync(f).toString('base64'));
  }
  return out;
}
