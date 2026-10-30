---
name: social-studio
description: Make a ready-to-post social media video (or image / carousel) with the Social Studio tool that lives in this repo (projects/social-studio) - script, voice-over, scenes, transitions, background music, caption and hashtags - and hand the user files to download and post themselves. Use this whenever the user asks to make, generate or write a reel, short, YouTube Short, Instagram or LinkedIn post, video script, caption or hashtags, "content for today", or says things like "ek video bana do", "post ke liye content chahiye", "reel banao", even if they never name Social Studio.
---

# Social Studio

Social Studio is a small local tool (Python + FFmpeg, no accounts) that turns one sentence into a finished post. The user is busy and does the posting themselves: your job is to hand over files that are ready to download, and a caption ready to paste. Never try to post anything for them.

## Make something

1. Find the tool folder (the one with `server.py`): normally `projects/social-studio` in this repo. If it is not there, search for `social-studio/server.py`.
2. Run the helper. It starts the tool if needed, waits for the AI and the video, and downloads the results:

```bash
python .claude/skills/social-studio/scripts/studio.py "3 website mistakes small businesses make" \
  --studio-dir projects/social-studio --out ./social-studio-output
```

Options: `--format video|image|carousel|story|text` (default video), `--length "15-30 sec"|"30-60 sec"|"60-90 sec"`, `--type educational|tips|motivational|promotional|...`, `--no-video` (text only). Leave the topic empty if the user has no idea; the AI picks one.

A video takes a few minutes (voice + editing), so run it in the background and tell the user it is working. Progress lines go to stderr; the final JSON goes to stdout.

3. Tell the user, in the language they wrote to you: where the `.mp4` is, the caption and hashtags (ready to paste), and that they can post it themselves. Keep it short. Mention the tool's own page (http://localhost:8000) if they want to edit the script or remake the video.

## When it fails

The helper prints JSON with `ok: false` and a `problem`:

- `no_ai`: no AI key / local AI is configured. The user must open http://localhost:8000, press **Setup** (top right) and add one free key (Groq or OpenRouter are the easiest) or install the local AI. You cannot do this for them and you should never ask them to paste keys into the chat.
- `no_video_tools`: FFmpeg or voices are missing. Same page, **Set up everything**. Meanwhile offer `--no-video` so they still get the script and caption.
- `ai_failed`: free AI limits are used up (they reset daily). The helper already retried once ignoring the cooldown. Say so, and suggest adding a second AI in Setup instead of retrying in a loop.
- `server_not_running`: pass `--studio-dir`, or ask them to run `python server.py` in the tool folder.

## Good to know

- The brand profile (business, audience, tone, language: Hinglish / Hindi / English) lives in the tool and shapes the writing. If the output sounds generic, ask the user to fill **Brand Profile** once rather than adding that to every request.
- Files and keys are stored in `projects/social-studio/data/`. Do not print, copy or commit anything from it (it holds the user's API keys).
- Image formats need an image-capable Gemini key (billing). If that fails, offer a video or a text-only result instead of retrying.
