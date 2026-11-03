---
name: reel-builder
description: Runs the full three-agent reel team (script writer, then editor, then delivery) to turn one sentence into a finished, ready-to-post vertical video with voice, avatar, B-roll, captions, music and sound effects, delivered as files to download. Use this whenever the user asks for a reel, short, TikTok, "ek video bana do", "reel banao", "is topic par video chahiye", or wants a social media video made end to end, even if they do not name the agents or Social Studio.
---

# Reel builder (orchestrator)

The user is busy and wants one thing: say a topic, get a finished video to download and post themselves. You coordinate three specialist agents that run one after another. Each one hands a small JSON to the next. You do not write scripts, edit or package files yourself; you brief the agents, pass the handoffs along, and speak to the user.

## Pipeline

1. **Brief.** From the user's sentence work out: topic, platform (default instagram), length (default 30-60 sec), language and tone if mentioned. Ask a question only if there is no topic at all. Otherwise assume and say what you assumed.
2. **`reel-script-writer`** with the brief. It returns `post_id`, the scene count and its assumptions.
3. **`reel-editor`** with the `post_id` (and the avatar / quality the user asked for). It returns the video path and a verdict.
   - If the verdict is `fail` because of the script (a line too long, a headline too long), send the editor's issues back to `reel-script-writer` with the same `post_id` for one revision, then run the editor again. Do this at most once.
   - If it failed because the tool is not set up (no video tools), stop and tell the user exactly what the editor reported.
4. **`reel-delivery`** with the `post_id` and the editor's verdict. It returns the folder, the files, the caption and the hashtags.
5. **Hand over.** Send the finished `.mp4` and `post-ready.txt` to the user with the file-sending tool you have (for example `SendUserFile`), and print the caption and hashtags in the chat so they can copy them. Keep the message short, in the user's language.

Run the agents one at a time, in this order: each needs the previous one's output.

## Where things live
- The tool: `projects/social-studio` (Python, no installs). The helper that every agent uses: `.claude/skills/social-studio/scripts/studio.py` (commands `status`, `script`, `edit`, `deliver`).
- Work files: `reel-work/`. Final files: `reels-output/`.
- The tool needs FFmpeg and a voice. Voices and stock footage (Pexels) are downloaded from the internet, so if this environment blocks those sites the editor will report it honestly; in that case offer the script and caption as the result, and say the video has to be made on the user's own computer.

## Things to be honest about
- The avatar is a cartoon presenter or the user's photo in a round frame, not a real human with lip-sync and gestures; that needs paid services.
- B-roll is real stock footage that matches each line only if a free Pexels key is saved in the tool; without it the scenes use the user's own photos and clips, or coloured backgrounds.
- You never post to Instagram, YouTube or LinkedIn. The user downloads the files and posts them.
