import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../lib/util.js';
import { AvatarUnavailable } from './base.js';

const dir = () => process.env.SADTALKER_DIR || '';
const py = () => process.env.SADTALKER_PYTHON || 'python3';

export default {
  id: 'sadtalker-local',
  label: 'SadTalker (local, open-source)',
  kind: 'local',
  capabilities: { lipSync: true, facialAnimation: true, headMotion: true },
  description: 'Open-source talking-head model: lip-sync plus head pose and blinking from a single photo. Heavier than Wav2Lip; GPU strongly recommended.',
  async status() {
    const setup = 'git clone https://github.com/OpenTalker/SadTalker, install requirements, run its scripts/download_models.sh (needs access to GitHub releases / HuggingFace), then set SADTALKER_DIR in .env';
    if (!dir()) return { ready: false, reason: 'SADTALKER_DIR is not set.', setup };
    if (!fs.existsSync(path.join(dir(), 'inference.py'))) return { ready: false, reason: `inference.py not found in ${dir()}`, setup };
    if (!fs.existsSync(path.join(dir(), 'checkpoints'))) return { ready: false, reason: 'checkpoints/ directory missing (models not downloaded).', setup };
    const r = await run(py(), ['-c', 'import torch;print(torch.__version__)']).catch((e) => ({ code: 1, stderr: e.message }));
    if (r.code !== 0) return { ready: false, reason: 'Python dependency missing: torch', setup };
    return { ready: true };
  },
  async generate({ image, audio, out, options = {} }) {
    const st = await this.status();
    if (!st.ready) throw new AvatarUnavailable(st.reason, { setup: st.setup });
    const resultDir = out + '.sadtalker';
    fs.mkdirSync(resultDir, { recursive: true });
    const args = ['inference.py', '--driven_audio', audio, '--source_image', image, '--result_dir', resultDir, '--preprocess', options.preprocess || 'crop', ...(options.still === false ? [] : ['--still'])];
    const r = await run(py(), args, { cwd: dir(), timeoutMs: 60 * 60_000 });
    const found = fs.existsSync(resultDir) ? fs.readdirSync(resultDir).filter((f) => f.endsWith('.mp4')).map((f) => path.join(resultDir, f)).sort().pop() : null;
    if (r.code !== 0 || !found) throw new Error('SadTalker failed: ' + r.stderr.split('\n').slice(-6).join('\n'));
    fs.renameSync(found, out);
    return { file: out };
  },
};
