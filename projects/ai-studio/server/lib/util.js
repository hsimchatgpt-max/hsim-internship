import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export const uid = (p = '') => p + crypto.randomBytes(5).toString('hex');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const today = () => new Date().toISOString().slice(0, 10);

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

/** Remove anything that looks like an API key from text before it is logged or returned. */
export function redact(s) {
  return String(s ?? '')
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[redacted-key]')
    .replace(/AQ\.[0-9A-Za-z_\-]{20,}/g, '[redacted-key]')
    .replace(/(key=)[^&\s"]+/gi, '$1[redacted]');
}

/** Run a command, resolve {code, stdout, stderr}. Never goes through a shell. */
export function run(cmd, args, { cwd, timeoutMs = 600000, input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${cmd} timed out`)); }, timeoutMs);
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, stdout, stderr }); });
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

export async function ffmpeg(args, opts) {
  const r = await run('ffmpeg', ['-hide_banner', '-y', '-loglevel', 'error', ...args], opts);
  if (r.code !== 0) throw new Error('ffmpeg failed: ' + r.stderr.split('\n').slice(-6).join('\n'));
  return r;
}

export async function probe(file) {
  const r = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (r.code !== 0) throw new Error('ffprobe failed: ' + r.stderr);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  return {
    duration: Number(j.format.duration || 0),
    hasVideo: !!v, hasAudio: !!a,
    width: v?.width, height: v?.height,
    sampleRate: a ? Number(a.sample_rate) : undefined,
  };
}
