import fs from 'node:fs';
import { ffmpeg, run, probe } from '../lib/util.js';
import { KEY_COLOR } from './presets.js';

/** Normalise an uploaded photo to a square-ish PNG (strip EXIF rotation, cap size). The ORIGINAL is never touched. */
export async function normalisePhoto(src, out, maxSide = 1024) {
  await ffmpeg(['-i', src, '-vf', `scale='min(${maxSide},iw)':'min(${maxSide},ih)':force_original_aspect_ratio=decrease`, '-frames:v', '1', '-update', '1', out]);
  return probe(out);
}

/** Sample the four corners of the photo; if they agree it is a plain backdrop that can be keyed out later. */
export async function detectBackdrop(file) {
  const r = await run('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'scale=64:64,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', '-'], { });
  // run() returns text; re-read raw via a second spawn with binary output
  const { spawn } = await import('node:child_process');
  const buf = await new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'scale=64:64,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', '-']);
    const chunks = []; p.stdout.on('data', (d) => chunks.push(d)); p.on('close', () => res(Buffer.concat(chunks))); p.on('error', rej);
  });
  if (buf.length < 64 * 64 * 3) return { plain: false };
  const px = (x, y) => [buf[(y * 64 + x) * 3], buf[(y * 64 + x) * 3 + 1], buf[(y * 64 + x) * 3 + 2]];
  const corners = [px(1, 1), px(62, 1), px(1, 20), px(62, 20)];
  const avg = corners[0].map((_, i) => Math.round(corners.reduce((a, c) => a + c[i], 0) / 4));
  const spread = Math.max(...corners.map((c) => Math.max(...c.map((v, i) => Math.abs(v - avg[i])))));
  const hex = '#' + avg.map((v) => v.toString(16).padStart(2, '0')).join('');
  return { plain: spread < 28, color: hex, spread };
}

export function rembgAvailable() {
  return run('python3', ['-c', 'import rembg']).then((r) => r.code === 0).catch(() => false);
}

/** If rembg is installed, cut the person out and place them on the flat chroma-key colour so the backdrop can be swapped exactly. */
export async function isolateOnKeyColor(src, out) {
  const cut = out + '.cut.png';
  const r = await run('python3', ['-c', 'import sys;from rembg import remove;open(sys.argv[2],"wb").write(remove(open(sys.argv[1],"rb").read()))', src, cut]);
  if (r.code !== 0) throw new Error('rembg failed: ' + r.stderr.split('\n').slice(-3).join(' '));
  await ffmpeg(['-f', 'lavfi', '-i', `color=c=${KEY_COLOR.replace('#', '0x')}:s=1024x1024`, '-i', cut, '-filter_complex', '[1:v]scale=1024:1024:force_original_aspect_ratio=decrease[fg];[0:v][fg]overlay=(W-w)/2:(H-h)/2', '-frames:v', '1', '-update', '1', out]);
  fs.unlinkSync(cut);
  return { keyColor: KEY_COLOR };
}
