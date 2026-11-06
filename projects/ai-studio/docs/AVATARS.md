# Avatar engines

The app never fakes a talking avatar. An avatar scene is only produced when an engine returns a video that
(1) has a video stream, (2) matches the audio length, and (3) shows real motion (a still image + audio scores ~0 and is rejected).
If no engine is ready, the project stops at the *avatar* step with a message; nothing is substituted.

Status of each engine is shown on **Avatars → Engines**.

## What is and isn't verified
| Engine | Status in this repo |
|---|---|
| Wav2Lip adapter | Implemented. **Not run end-to-end here**: the build sandbox could not reach GitHub/HuggingFace to download model weights. |
| SadTalker adapter | Implemented. Same limitation. |
| External HTTP adapter | Implemented against the contract below. **Not tested against any vendor.** |
| Verification guard, key-colour background replacement, compositing with visual scenes | Tested (see `tests/unit/media.test.js`). |

## Option A — Wav2Lip (local, mouth movement only)
```bash
git clone https://github.com/Rudrabha/Wav2Lip && cd Wav2Lip
pip install -r requirements.txt
# put wav2lip_gan.pth in checkpoints/ and s3fd.pth in face_detection/detection/sfd/ (links in the Wav2Lip README)
```
`.env`: `WAV2LIP_DIR=/path/to/Wav2Lip` (optional `WAV2LIP_PYTHON`, `WAV2LIP_CHECKPOINT`).
Needs a detectable *human* face — the illustrated presenters may fail detection; use real photos.

## Option B — SadTalker (local, head motion + blinking)
```bash
git clone https://github.com/OpenTalker/SadTalker && cd SadTalker
pip install -r requirements.txt && bash scripts/download_models.sh
```
`.env`: `SADTALKER_DIR=/path/to/SadTalker` (optional `SADTALKER_PYTHON`). A GPU is strongly recommended.

## Option C — External HTTP service (optional)
`.env`: `AVATAR_HTTP_URL=https://your-service` and optionally `AVATAR_HTTP_KEY`. It uploads the photo and audio to that
service, so the app asks for explicit confirmation before every use and never auto-selects it.
```
POST {URL}/generate   multipart: image (png), audio (wav)
  -> 200 video/mp4                       (synchronous), or
  -> 202 {"status_url": "https://..."}   then GET status_url ->
        {"status":"processing"} | {"status":"done","video_url":"..."} | {"status":"failed","error":"..."}
```

## Background replacement
* **Ready-made presenters** are drawn on a flat chroma-key green, so the background is replaced exactly.
* **Your photo**: if the corners agree the app detects a plain backdrop and can key it out (*colour-key*). For busy backgrounds,
  install the optional `rembg` Python package (`pip install rembg`) and use **Remove bg** on the photo; the person is then
  placed on the key colour before animation. `rembg` is not installed here, so that path is untested.
