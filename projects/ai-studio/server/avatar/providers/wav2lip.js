import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../lib/util.js';
import { AvatarUnavailable } from './base.js';

const dir = () => process.env.WAV2LIP_DIR || '';
const py = () => process.env.WAV2LIP_PYTHON || 'python3';
const ckpt = () => path.join(dir(), 'checkpoints', process.env.WAV2LIP_CHECKPOINT || 'wav2lip_gan.pth');

export default {
  id: 'wav2lip-local',
  label: 'Wav2Lip (local, open-source)',
  kind: 'local',
  capabilities: { lipSync: true, facialAnimation: false, headMotion: false },
  description: 'Open-source lip-sync that runs on your machine. Mouth movement only (no head motion). Works on a still portrait; needs a detectable human face. GPU strongly recommended.',
  async status() {
    const setup = 'git clone https://github.com/Rudrabha/Wav2Lip && cd Wav2Lip && pip install -r requirements.txt, download wav2lip_gan.pth into checkpoints/ and s3fd.pth into face_detection/detection/sfd/, then set WAV2LIP_DIR in .env';
    if (!dir()) return { ready: false, reason: 'WAV2LIP_DIR is not set.', setup };
    if (!fs.existsSync(path.join(dir(), 'inference.py'))) return { ready: false, reason: `inference.py not found in ${dir()}`, setup };
    if (!fs.existsSync(ckpt())) return { ready: false, reason: `Checkpoint missing: ${ckpt()}`, setup };
    const r = await run(py(), ['-c', 'import torch,cv2;print(torch.__version__)']).catch((e) => ({ code: 1, stderr: e.message }));
    if (r.code !== 0) return { ready: false, reason: 'Python deps missing (torch/opencv): ' + String(r.stderr).split('\n').filter(Boolean).pop(), setup };
    return { ready: true };
  },
  async generate({ image, audio, out }) {
    const st = await this.status();
    if (!st.ready) throw new AvatarUnavailable(st.reason, { setup: st.setup });
    const args = ['inference.py', '--checkpoint_path', ckpt(), '--face', image, '--audio', audio, '--outfile', out, '--pads', '0', '10', '0', '0', '--nosmooth'];
    const r = await run(py(), args, { cwd: dir(), timeoutMs: 30 * 60_000 });
    if (r.code !== 0 || !fs.existsSync(out)) throw new Error('Wav2Lip failed: ' + r.stderr.split('\n').slice(-6).join('\n'));
    return { file: out };
  },
};
