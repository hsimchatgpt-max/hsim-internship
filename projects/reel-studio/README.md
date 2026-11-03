# Reel Studio

Topic do → Instagram Reel aur LinkedIn video (Hindi / Hinglish / English) taiyaar. **Sab free tools.**

```
Topic ─► Agent 1 Script Writer ─► Agent 2 Visual Director ─► Agent 3 Video Editor ─► Agent 4 Analyzer ─► download
              ▲                              ▲                        ▲                    │
              └──────────── score kam ho to analyzer sahi agent ko wapas bhejta hai (max 2 baar) ┘
```

| Agent | File | Kya karta hai |
|---|---|---|
| 1. Script Writer | `agents/script_writer.py` | Hook + scenes + on-screen text + 3 titles + caption + hashtags (platform ke style mein) |
| 2. Visual Director | `agents/visual_director.py` | Har scene ke liye: avatar / B-roll / text-card decide karta hai, stock keywords banata hai, footage download karta hai |
| 3. Video Editor | `agents/editor.py` | Cuts + punch-in zoom, transitions, word-by-word captions, headline labels, background music (auto-duck), whoosh/pop SFX, loudness normalise, mp4 |
| 4. Analyzer | `agents/analyzer.py` | Asli file measure karta hai (hook, pacing, loudness, captions, format, CTA), score /100, aur fix bhejta hai |

## Setup (ek baar)

```bash
# 1. ffmpeg install karo (with libass): https://ffmpeg.org/download.html
pip install -r requirements.txt
cp .env.example .env      # free keys bharo (neeche dekho)
```

Free keys (sirf ek LLM key chahiye, baaki optional):

| Kaam | Free option |
|---|---|
| Script/LLM | Gemini (`GEMINI_API_KEY`) ya Groq (`GROQ_API_KEY`) ya local Ollama (`OLLAMA_MODEL`). Kuch na ho to generic template script banti hai |
| Voice | `edge-tts` (Microsoft neural voices, key nahi chahiye, internet chahiye) |
| B-roll | Pexels (`PEXELS_API_KEY`) / Pixabay, ya apna folder `--broll-dir` |
| Music + SFX | Tool khud generate karta hai (copyright-free) |
| Hindi font | Noto Sans Devanagari, pehli baar khud download hota hai |

## Use

```bash
# AI avatar (cartoon presenter) + dono platform, Hinglish
python -m reelstudio "Subah jaldi uthne ke fayde" -l hinglish

# Teeno bhasha me, sirf Instagram
python -m reelstudio "How to save money in 20s" -p instagram -l hindi hinglish english -d 30

# Apna AI-generated avatar image
python -m reelstudio "Topic" --avatar-image my_avatar.png

# Apna face: script padhte hue khud ko record karo (pehle script dekh lo: pehli baar chala ke), phir
python -m reelstudio "Topic" --avatar face --face-video me.mp4
```

Output `output/<topic>/` mein: `instagram_<lang>.mp4` (1080x1920), `linkedin_<lang>.mp4` (1080x1350),
`*_post.txt` (titles, caption, hashtags, script), `*_preview.jpg` (contact sheet), `*_analysis.json`, `REPORT.md`.

### Own face mode kaise kaam karta hai
1. Pehle tool ko `--avatar ai` se ek baar chalao, `*_post.txt` mein script dekho.
2. Wo script padhte hue khud ko record karo (pehle second se bolna shuru).
3. `--avatar face --face-video me.mp4`: awaaz aur chehra aapka, B-roll/captions/music/edit tool lagata hai.
   (`pip install faster-whisper` karo to captions exactly aapke bole shabdon par sync hote hain.)

## Honest limitations
- **AI avatar** ek cartoon presenter hai jiska mooh awaaz ke saath hilta hai. Realistic lip-sync (photo ko bulwana) free mein
  GPU chahiye (SadTalker/Wav2Lip, Colab par chalta hai). `--avatar-image` se aap us tool ka bana clip/image lga sakte ho.
- Analyzer "viral hoga" guarantee nahi karta; wo hook, pacing, captions, loudness, length aur CTA jaise repeatable rules check karta hai.
- Offline (internet nahi): voice ki jagah placeholder beep banti hai aur script generic template; REPORT.md mein warning aati hai.

## Test
```bash
python -m unittest discover -s tests -v
```
