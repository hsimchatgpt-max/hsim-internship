import fs from 'node:fs';
import { probe, run } from '../lib/util.js';
import { AvatarUnavailable } from './providers/base.js';
import wav2lip from './providers/wav2lip.js';
import sadtalker from './providers/sadtalker.js';
import http from './providers/http.js';

export const PROVIDERS = [sadtalker, wav2lip, http];
export const getProvider = (id) => PROVIDERS.find((p) => p.id === id);

export async function providerStatuses() {
  return Promise.all(PROVIDERS.map(async (p) => ({ id: p.id, label: p.label, kind: p.kind, description: p.description, capabilities: p.capabilities, ...(await p.status()) })));
}

/** Pick a provider: explicit choice, else first ready LOCAL provider. External providers are never auto-selected. */
export async function pickProvider(id) {
  if (id) {
    const p = getProvider(id);
    if (!p) throw new Error(`Unknown avatar provider ${id}`);
    return p;
  }
  for (const p of PROVIDERS.filter((x) => x.kind === 'local')) if ((await p.status()).ready) return p;
  throw new AvatarUnavailable('No local avatar engine is installed and ready.', { setup: 'See docs/AVATARS.md. Install Wav2Lip or SadTalker locally, or configure the optional external adapter.' });
}

/** Average inter-frame luma difference (YDIF). A talking head moves; a still image + audio scores ~0. */
export async function motionScore(file) {
  const r = await run('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-vf', 'scale=160:-2,signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=-', '-an', '-f', 'null', '-']);
  const vals = [...r.stdout.matchAll(/YDIF=([-+\d.eE]+)/g)].map((m) => Number(m[1]));
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * Verify that a provider result is a genuine animated video that matches the audio. Throws otherwise.
 * This is what stops a still image with audio from being passed off as a talking avatar.
 */
export async function verifyAvatarVideo(file, audioDuration, { minMotion = 0.05 } = {}) {
  if (!fs.existsSync(file)) throw new Error('Avatar provider produced no file.');
  const info = await probe(file);
  if (!info.hasVideo) throw new Error('Avatar output has no video stream.');
  if (Math.abs(info.duration - audioDuration) > Math.max(0.6, audioDuration * 0.08))
    throw new Error(`Avatar video length (${info.duration.toFixed(2)}s) does not match the audio (${audioDuration.toFixed(2)}s).`);
  const motion = await motionScore(file);
  if (motion < minMotion) throw new Error(`Avatar output shows no facial/mouth motion (score ${motion.toFixed(3)}). It looks like a still image, so it was rejected.`);
  return { ...info, motion };
}

export async function generateTalkingVideo({ provider, image, audio, audioDuration, out, options }) {
  await provider.generate({ image, audio, out, options });
  const v = await verifyAvatarVideo(out, audioDuration);
  return { file: out, provider: provider.id, verified: true, ...v };
}
