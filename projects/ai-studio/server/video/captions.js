import fs from 'node:fs';

const hasDevanagari = (s) => /[\u0900-\u097F]/.test(s);
export const FONTS_DIR = new URL('../assets/fonts', import.meta.url).pathname;
const FONT_LATIN = 'Noto Sans';
const FONT_DEVA = 'Noto Sans Devanagari';

const assTime = (t) => {
  const cs = Math.round(t * 100);
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const esc = (s) => s.replace(/[{}\\]/g, '').replace(/\n/g, ' ');
// ASS colours are &HBBGGRR&
const bgr = (hex, fallback = 'FFFFFF') => { const h = (/^#?([0-9a-f]{6})$/i.exec(hex || '')?.[1] || fallback); return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`; };

/**
 * Word timings are ESTIMATED: Gemini TTS returns audio only (no timestamps), so each word gets time proportional to
 * its length (plus a small pause weight on punctuation) across the speech portion of the scene.
 */
export function estimateWordTimings(text, speechStart, speechEnd) {
  const words = text.split(/\s+/).filter(Boolean);
  const weights = words.map((w) => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, '').length) + (/[,.;:!?।]$/.test(w) ? 3 : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(0.1, speechEnd - speechStart);
  let t = speechStart;
  return words.map((w, i) => { const d = (weights[i] / total) * span; const r = { w, start: t, end: t + d }; t += d; return r; });
}

/**
 * Build an ASS file: animated word-highlight captions (chunks of ≤4 words that pop in; the spoken word is highlighted)
 * plus an optional top headline (onScreenText) that fades in.
 */
export function buildAss({ file, width, height, narration, headline, speechStart = 0.1, speechEnd, sceneDuration, accent = '#FFD23F', captionsOn = true }) {
  const fs_ = Math.round(height * (width < height ? 0.044 : 0.06));
  const margin = Math.round(height * (width < height ? 0.2 : 0.1));
  const font = hasDevanagari(narration + (headline || '')) ? FONT_DEVA : FONT_LATIN;
  const hl = bgr(accent, 'FFD23F');
  const head = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    // Karaoke: words are drawn in SecondaryColour until sung, then PrimaryColour.
    `Style: Cap,${font},${fs_},${hl},&H00FFFFFF&,&H00000000&,&H80000000&,-1,0,0,0,100,100,0,0,1,${Math.max(3, Math.round(fs_ / 12))},2,2,${Math.round(width * 0.06)},${Math.round(width * 0.06)},${margin},1`,
    `Style: Head,${font},${Math.round(fs_ * 1.15)},&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H80000000&,-1,0,0,0,100,100,0,0,1,${Math.max(3, Math.round(fs_ / 12))},2,8,${Math.round(width * 0.07)},${Math.round(width * 0.07)},${Math.round(height * 0.08)},1`,
    '', '[Events]', 'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
  ];
  const ev = [];
  if (headline) ev.push(`Dialogue: 1,${assTime(0.2)},${assTime(sceneDuration - 0.2)},Head,,0,0,0,,{\\fad(350,250)}${esc(headline)}`);
  if (captionsOn && narration) {
    const timings = estimateWordTimings(narration, speechStart, speechEnd ?? sceneDuration - 0.3);
    for (let i = 0; i < timings.length; i += 4) {
      const chunk = timings.slice(i, i + 4);
      const start = chunk[0].start, end = chunk[chunk.length - 1].end;
      const text = chunk.map((c) => `{\\kf${Math.max(1, Math.round((c.end - c.start) * 100))}}${esc(c.w)}`).join(' ');
      ev.push(`Dialogue: 2,${assTime(start)},${assTime(end + 0.05)},Cap,,0,0,0,,{\\fad(60,40)\\fscx85\\fscy85\\t(0,120,\\fscx100\\fscy100)}${text}`);
    }
  }
  fs.writeFileSync(file, [...head, ...ev, ''].join('\n'));
  return file;
}
