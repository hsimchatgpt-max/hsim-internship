import fs from 'node:fs';
import { sleep } from '../../lib/util.js';
import { AvatarUnavailable } from './base.js';

const url = () => (process.env.AVATAR_HTTP_URL || '').replace(/\/$/, '');
const headers = () => (process.env.AVATAR_HTTP_KEY ? { Authorization: `Bearer ${process.env.AVATAR_HTTP_KEY}` } : {});

/**
 * Optional EXTERNAL adapter (for when local processing is impractical).
 * It speaks a small documented contract (docs/AVATARS.md) so you can put any talking-head vendor or your own GPU
 * server behind it. It has NOT been tested against any specific vendor. Because it uploads the user's photo and
 * audio to a third party and may cost money, the pipeline requires explicit confirmation before each use.
 *
 *   POST {URL}/generate  multipart: image, audio            -> 200 video/mp4  OR  202 {"status_url": "..."}
 *   GET  status_url                                          -> {"status":"processing"|"done"|"failed","video_url"?,"error"?}
 */
export default {
  id: 'http-external',
  label: 'External HTTP avatar service (optional)',
  kind: 'external',
  capabilities: { lipSync: true, facialAnimation: true, headMotion: true },
  description: 'Sends the photo and audio to an external talking-avatar API you configure. Uploads personal images to a third party and may be billed by that provider.',
  async status() {
    if (!url()) return { ready: false, reason: 'AVATAR_HTTP_URL is not set.', setup: 'Set AVATAR_HTTP_URL (and optionally AVATAR_HTTP_KEY) in .env — see docs/AVATARS.md for the contract.' };
    return { ready: true };
  },
  async generate({ image, audio, out }) {
    const st = await this.status();
    if (!st.ready) throw new AvatarUnavailable(st.reason, { setup: st.setup });
    const form = new FormData();
    form.append('image', new Blob([fs.readFileSync(image)]), 'image.png');
    form.append('audio', new Blob([fs.readFileSync(audio)]), 'audio.wav');
    let res = await fetch(`${url()}/generate`, { method: 'POST', headers: headers(), body: form, signal: AbortSignal.timeout(120000) });
    if (res.status === 202) {
      const { status_url } = await res.json();
      for (let i = 0; i < 180; i++) {
        await sleep(5000);
        const j = await (await fetch(status_url, { headers: headers() })).json();
        if (j.status === 'failed') throw new Error('External avatar service failed: ' + (j.error || 'unknown'));
        if (j.status === 'done') { res = await fetch(j.video_url, { headers: headers() }); break; }
      }
    }
    if (!res.ok) throw new Error(`External avatar service HTTP ${res.status}`);
    fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    return { file: out };
  },
};
