"""Platform, language and voice settings in one place."""
from __future__ import annotations

import os
from pathlib import Path

FPS = 30

PLATFORMS = {
    "instagram": {
        "label": "Instagram Reel",
        "size": (1080, 1920),            # 9:16
        "ideal_sec": (15, 45),
        "max_sec": 90,
        "target_lufs": -14.0,
        "shot_sec": (1.2, 3.2),          # fast cuts perform best on reels
        "caption_margin_v": 520,         # keeps captions above the Reels UI
        "transitions": ["slideleft", "zoomin", "wipeleft", "circleopen", "fade"],
        "music_bpm": 112,
        "music_gain": 0.20,
        "hashtags": (5, 8),
        "caption_limit": 2200,
        "style": (
            "Punchy, trendy, emotional, conversational. Very short sentences. "
            "Pattern-interrupt hook in the first 3 seconds (a bold claim, a question or a number). "
            "Open loops, deliver value fast, end with a CTA (save / follow / comment)."
        ),
    },
    "linkedin": {
        "label": "LinkedIn Video",
        "size": (1080, 1350),            # 4:5, biggest non-fullscreen feed format
        "ideal_sec": (30, 75),
        "max_sec": 600,
        "target_lufs": -16.0,
        "shot_sec": (2.0, 4.5),
        "caption_margin_v": 150,
        "transitions": ["fade", "slideleft"],
        "music_bpm": 90,
        "music_gain": 0.14,
        "hashtags": (3, 5),
        "caption_limit": 3000,
        "style": (
            "Professional but human. Insight-led storytelling: a sharp hook (a surprising lesson, "
            "mistake or stat), 2-3 concrete takeaways, then a thoughtful question to invite comments. "
            "No slang overload, no clickbait. Written for people who watch with the sound OFF too."
        ),
    },
}

LANGUAGES = {
    "hindi":    {"label": "Hindi (Devanagari)",    "voice_f": "hi-IN-SwaraNeural",   "voice_m": "hi-IN-MadhurNeural",
                 "wps": 2.3, "script": "Hindi written in Devanagari script"},
    "hinglish": {"label": "Hinglish (Roman Hindi)", "voice_f": "en-IN-NeerjaNeural", "voice_m": "en-IN-PrabhatNeural",
                 "wps": 2.6, "script": "Hinglish: Hindi written in Roman/English letters, the way Indians text, mixing common English words"},
    "english":  {"label": "English",               "voice_f": "en-IN-NeerjaNeural", "voice_m": "en-IN-PrabhatNeural",
                 "wps": 2.6, "script": "simple, clear English"},
}

CACHE_DIR = Path(os.environ.get("REELSTUDIO_CACHE", Path.home() / ".cache" / "reelstudio"))

# Themes used for generated backgrounds / cartoon avatar (BGR-free, plain RGB)
THEMES = [
    ((22, 12, 60), (120, 40, 160)),
    ((8, 30, 70), (20, 130, 170)),
    ((50, 10, 30), (200, 70, 80)),
    ((10, 45, 40), (40, 160, 110)),
]
