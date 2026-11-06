import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { generateContent, inlineParts, GeminiError } from './gemini.js';
import { resolveModel, markStatus } from './models.js';
import { assertAllowed } from './guard.js';
import { VOICES, LANGUAGES, TONES } from './voices.js';
import { dirs } from '../config.js';
import { ffmpeg, probe } from './util.js';

/** Wrap raw 16-bit mono PCM (Gemini returns audio/L16;rate=24000 in some cases) as WAV. */
export function pcmToWav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export function buildSpeechPrompt({ text, language = 'en-US', tone = 'neutral' }) {
  const lang = LANGUAGES.find((l) => l.code === language);
  const style = TONES[tone] || TONES.neutral;
  const hint = lang?.hint ? ` ${lang.hint}` : lang && !language.startsWith('en') ? ` The language is ${lang.label}.` : '';
  // The instruction is separated from the transcript so the model does not read it aloud.
  return `Read the transcript below aloud ${style}.${hint} Speak ONLY the transcript, never these instructions.\n\nTRANSCRIPT:\n${text}`;
}

/**
 * Generate a WAV for `text`. Voice/language/tone are passed in explicitly so every scene of a project
 * uses identical settings; speed is applied afterwards as an exact tempo change (pitch preserved) and
 * loudness is normalised to -16 LUFS so scenes sound like one continuous recording.
 */
export async function synthesize({ text, voice = 'Kore', language = 'en-US', tone = 'neutral', speed = 1, outFile, model, seed = 7 }) {
  if (!VOICES.some((v) => v.name === voice)) throw new GeminiError('bad_request', `Unknown voice "${voice}"`);
  if (!text?.trim()) throw new GeminiError('bad_request', 'Empty text');
  const m = model || (await resolveModel('tts')).model;
  if (!m) throw new GeminiError('not_found', 'No TTS model is available for this API key.');
  assertAllowed({ kind: 'tts', model: m });
  let resp;
  try {
    resp = await generateContent(m, {
      contents: [{ parts: [{ text: buildSpeechPrompt({ text, language, tone }) }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        seed,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }, { kind: 'tts' });
  } catch (e) {
    if (e.kind === 'tier_blocked') markStatus(m, 'needs_billing', e.message);
    if (e.kind === 'quota_daily') markStatus(m, 'quota_exhausted', 'Daily free-tier quota used up', Math.min(e.retryAfterMs || 6 * 3600e3, 24 * 3600e3));
    throw e;
  }
  markStatus(m, 'free_ok', 'last call succeeded'); // "ok" on this key; Google does not say whether a call was billed
  const part = inlineParts(resp).find((p) => p.inlineData?.mimeType?.startsWith('audio/'));
  if (!part) throw new GeminiError('empty', 'TTS returned no audio (model may have refused the text).');
  let buf = Buffer.from(part.inlineData.data, 'base64');
  const mime = part.inlineData.mimeType;
  if (!mime.includes('wav')) buf = pcmToWav(buf, Number(/rate=(\d+)/.exec(mime)?.[1] || 24000));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const raw = outFile + '.raw.wav';
  fs.writeFileSync(raw, buf);
  const filters = [];
  if (Math.abs(speed - 1) > 0.01) filters.push(`atempo=${Math.min(2, Math.max(0.5, speed)).toFixed(3)}`);
  filters.push('loudnorm=I=-16:TP=-1.5:LRA=11', 'aresample=44100');
  await ffmpeg(['-i', raw, '-af', filters.join(','), '-ac', '1', outFile]);
  fs.unlinkSync(raw);
  const info = await probe(outFile);
  return { file: outFile, duration: info.duration, model: m, voice, language, tone, speed };
}

/** Cached short preview of a voice (so repeated previews do not burn quota). */
export async function previewVoice({ voice, language, tone, speed, sample }) {
  const text = sample || (language === 'hi-IN' ? 'नमस्ते! आज हम कुछ नया और दिलचस्प सीखेंगे।'
    : language === 'hinglish' ? 'Namaste dosto! Aaj hum kuch naya aur interesting seekhne wale hain.'
    : 'Hello! Today we are going to learn something new and exciting together.');
  const key = crypto.createHash('sha1').update(JSON.stringify([voice, language, tone, speed, text])).digest('hex').slice(0, 16);
  const file = path.join(dirs.cache, `preview-${key}.wav`);
  if (fs.existsSync(file)) return { file, cached: true };
  const r = await synthesize({ text, voice, language, tone, speed, outFile: file });
  return { ...r, cached: false };
}
