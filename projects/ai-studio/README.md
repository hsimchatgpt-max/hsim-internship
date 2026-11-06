# AI Studio — Gemini-powered content studio

Command → strategy → script → (your approval) → scene plan → Gemini TTS voice → avatar / visuals → FFmpeg edit → QC → MP4.
Image posts: command → copy → background → brand design → QC → PNG/JPG. Every project is saved and every part is editable.

```bash
cd projects/ai-studio
npm install
cp .env.example .env        # put GEMINI_API_KEY in .env (the key stays on the server)
npm start                   # http://127.0.0.1:8787
npm test                    # 23 offline tests
npm run test:live           # real Gemini checks (uses a few free-tier requests)
```
Requires Node 22+, `ffmpeg`/`ffprobe` (with libass, xfade, zoompan), and Chromium via `playwright` (image posts / presenter build).

## What was verified against the real API (free-tier key)
| Capability | Result |
|---|---|
| Text agents (`gemini-3.x-flash`) | Working. 9 agents, structured JSON, Hindi/Hinglish. |
| TTS (`gemini-3.8-flash-tts`) | Working. Transcribed back: speaks the transcript, not the instructions. |
| Image generation (4 models) | **Quota 0 on free tier.** Code implemented, *unverified*. |
| Omni video (`gemini-omni-1.1-flash` + 2 others) | **Quota 0 on free tier.** Code implemented, *unverified*. |
| Local lip-sync engines | Adapters implemented, **not run** (weights unreachable from the build sandbox). See `docs/AVATARS.md`. |

Free-tier limits observed: `gemini-3.8-flash` 20 req/day, `gemini-3.8-flash-tts` 10 req/day (per model). One video ≈ 9 text calls + 1 TTS call per scene.
The app counts usage, detects daily/zero quotas, remembers them, and falls through to other free text models.

## Spending rules
* Free-class (text, TTS): run freely under local daily caps.
* Paid-class (image, video, music): refused unless **Allow paid generation** is on, a price is entered (no prices are assumed), the estimate fits the daily ceiling, **and** you confirm each run. Without media, scenes use a local animated gradient (clearly labelled “not AI”).

## Layout
`server/lib` client, guard, ledger, TTS · `server/agents` the 8 Gemini agents · `server/avatar` providers + verification · `server/video` FFmpeg engine · `server/workflow` resumable pipeline · `web/` UI.
Caveats: no login (binds to 127.0.0.1); caption word timing is estimated (TTS returns no timestamps); the Research agent has no web access unless you enable Search grounding.

## Windows quick start
1. Install Node.js 22+ (nodejs.org) and FFmpeg (`winget install Gyan.FFmpeg`, then reopen the terminal; check `ffmpeg -version`).
2. In the project folder: `npm install`, then `npx playwright install chromium` (needed for image posts).
3. Copy `.env.example` to `.env` (`copy .env.example .env`), open it in Notepad and fill `GEMINI_API_KEY=`.
4. `npm start`, then open http://127.0.0.1:8787.
Note: Windows paths were adjusted but this tool was built and tested on Linux, so report any Windows-specific error.
