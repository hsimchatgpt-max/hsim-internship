"""Agent 1 - Script Writer: topic -> scenes (voiceover + on-screen text), titles, caption, hashtags."""
from __future__ import annotations

import re

from .. import llm
from ..config import LANGUAGES, PLATFORMS

SYSTEM = (
    "You are a senior short-form video scriptwriter who writes viral {platform_label} scripts. "
    "Language of ALL spoken/visible text: {lang_script}. {style}"
)

PROMPT = """Topic: {topic}
Platform: {platform_label}
Target length: about {seconds} seconds of speech = about {words} words in total.

Write the video script as JSON with exactly this shape:
{{
  "title_options": ["3 different catchy titles, max 70 chars each"],
  "scenes": [
    {{"role": "hook", "voiceover": "first 3 seconds, max 12 words, must stop the scroll", "on_screen_text": "2-4 bold words"}},
    {{"role": "body", "voiceover": "...", "on_screen_text": "2-4 bold words"}},
    {{"role": "cta", "voiceover": "closing call to action", "on_screen_text": "2-4 bold words"}}
  ],
  "caption": "post caption, first line is a hook, ends with a question or CTA",
  "hashtags": ["{hmin}-{hmax} relevant hashtags starting with #"]
}}
Rules: 5 to 8 scenes, each voiceover 1-2 short sentences (6-22 words). Total about {words} words.
Spoken text must be pure speech: no emojis, no stage directions, no hashtags, no markdown.
Every fact must be general knowledge or clearly hedged; never invent statistics or quotes.
"""

REVISE = """Here is the current script JSON:
{script}

An automated video analyzer found these problems:
{issues}

Rewrite the script fixing exactly these problems, keep the topic and the same JSON shape, same language.
Target about {words} words total."""


def _target_words(language: str, seconds: int) -> int:
    return int(seconds * LANGUAGES[language]["wps"])


# ---------- offline fallback (no API key): generic but structurally correct ----------
_OFFLINE = {
    "english": [
        ("hook", "Nobody tells you this about {t}.", "STOP SCROLLING"),
        ("body", "Most people get {t} wrong because they start with the hard part.", "THE MISTAKE"),
        ("body", "Start small. One simple step today beats a perfect plan next month.", "START SMALL"),
        ("body", "Track your progress every week, and fix only the one thing that matters most.", "TRACK IT"),
        ("body", "Consistency with {t} will beat talent, every single time.", "CONSISTENCY WINS"),
        ("cta", "Save this video and follow for more. What is your biggest struggle with {t}?", "SAVE + FOLLOW"),
    ],
    "hinglish": [
        ("hook", "{t} ke baare mein ye baat koi nahi batata.", "RUKO ZARA"),
        ("body", "Zyada tar log {t} mein galti karte hain, kyunki wo sabse mushkil cheez se shuru karte hain.", "YE GALTI"),
        ("body", "Chhota start karo. Aaj ka ek simple step, agle mahine ke perfect plan se behtar hai.", "CHHOTA START"),
        ("body", "Har hafte apna progress dekho, aur sirf wahi ek cheez theek karo jo sabse zaroori hai.", "TRACK KARO"),
        ("body", "{t} mein consistency, talent ko har baar harati hai.", "CONSISTENCY"),
        ("cta", "Is video ko save karo aur follow karo. {t} mein aapki sabse badi dikkat kya hai? Comment karo.", "SAVE + FOLLOW"),
    ],
    "hindi": [
        ("hook", "{t} के बारे में ये बात कोई नहीं बताता।", "ज़रा रुकिए"),
        ("body", "ज़्यादातर लोग {t} में गलती करते हैं, क्योंकि वो सबसे मुश्किल चीज़ से शुरू करते हैं।", "यही गलती"),
        ("body", "छोटी शुरुआत कीजिए। आज का एक आसान कदम, अगले महीने के परफेक्ट प्लान से बेहतर है।", "छोटी शुरुआत"),
        ("body", "हर हफ्ते अपनी प्रगति देखिए, और सिर्फ वही एक चीज़ सुधारिए जो सबसे ज़रूरी है।", "ट्रैक कीजिए"),
        ("body", "{t} में निरंतरता, टैलेंट को हर बार हराती है।", "निरंतरता"),
        ("cta", "इस वीडियो को सेव कीजिए और फॉलो कीजिए। {t} में आपकी सबसे बड़ी दिक्कत क्या है? कमेंट में बताइए।", "सेव + फॉलो"),
    ],
}


def _offline(topic: str, platform: str, language: str) -> dict:
    t = topic.strip().rstrip(".")
    scenes = [{"role": r, "voiceover": v.format(t=t), "on_screen_text": o} for r, v, o in _OFFLINE[language]]
    tag = re.sub(r"[^\w]", "", topic.title().replace(" ", ""))
    hmin, hmax = PLATFORMS[platform]["hashtags"]
    tags = [f"#{tag}", "#tips", "#learn", "#growth", "#motivation", "#reels", "#india", "#trending"]
    if platform == "linkedin":
        tags = [f"#{tag}", "#careergrowth", "#learning", "#leadership", "#productivity"]
    return {
        "title_options": [t.title(), f"{t.title()}: what nobody tells you", f"Stop making this {t} mistake"],
        "scenes": scenes,
        "caption": f"{scenes[0]['voiceover']}\n\n{scenes[-1]['voiceover']}",
        "hashtags": tags[:hmax],
        "_offline": True,
    }


def _validate(d: dict, platform: str) -> dict:
    scenes = d.get("scenes")
    if not isinstance(scenes, list) or not (3 <= len(scenes) <= 12):
        raise ValueError("scenes missing or wrong count")
    clean = []
    for i, s in enumerate(scenes):
        vo = re.sub(r"\s+", " ", str(s.get("voiceover", ""))).strip()
        if not vo:
            raise ValueError(f"scene {i + 1} has empty voiceover")
        clean.append({
            "role": s.get("role") if s.get("role") in ("hook", "body", "cta") else "body",
            "voiceover": vo,
            "on_screen_text": str(s.get("on_screen_text", "")).strip()[:40],
        })
    clean[0]["role"], clean[-1]["role"] = "hook", "cta"
    tags = [("#" + str(h).lstrip("#").replace(" ", "")) for h in d.get("hashtags", []) if str(h).strip("# ")]
    hmax = PLATFORMS[platform]["hashtags"][1]
    titles = [str(t).strip() for t in d.get("title_options", []) if str(t).strip()] or [clean[0]["voiceover"][:60]]
    return {"title_options": titles[:3], "scenes": clean, "caption": str(d.get("caption", "")).strip(),
            "hashtags": tags[:hmax]}


def write(topic: str, platform: str, language: str, seconds: int, log=print) -> dict:
    pf, lg = PLATFORMS[platform], LANGUAGES[language]
    words = _target_words(language, seconds)
    result = None
    if llm.available():
        for attempt in (1, 2):
            try:
                d = llm.chat_json(
                    SYSTEM.format(platform_label=pf["label"], lang_script=lg["script"], style=pf["style"]),
                    PROMPT.format(topic=topic, platform_label=pf["label"], seconds=seconds, words=words,
                                  hmin=pf["hashtags"][0], hmax=pf["hashtags"][1]))
                result = _validate(d, platform)
                break
            except (llm.LLMError, ValueError) as e:
                log(f"  [script] LLM attempt {attempt} failed: {e}")
    if result is None:
        log("  [script] no LLM available -> using the built-in generic template "
            "(add a free GEMINI_API_KEY or GROQ_API_KEY in .env for real scripts)")
        result = _offline(topic, platform, language)
    result.update(topic=topic, platform=platform, language=language, seconds=seconds, target_words=words)
    result["title"] = result["title_options"][0]
    if not result["caption"]:
        result["caption"] = result["scenes"][0]["voiceover"]
    return result


def revise(script: dict, issues: list[str], log=print) -> dict | None:
    """Rewrite script to fix analyzer feedback. Returns None when no LLM is available."""
    if not llm.available() or script.get("_offline"):
        return None
    import json
    pf, lg = PLATFORMS[script["platform"]], LANGUAGES[script["language"]]
    keep = {k: script[k] for k in ("title_options", "scenes", "caption", "hashtags")}
    try:
        d = llm.chat_json(
            SYSTEM.format(platform_label=pf["label"], lang_script=lg["script"], style=pf["style"]),
            REVISE.format(script=json.dumps(keep, ensure_ascii=False), issues="\n".join(f"- {i}" for i in issues),
                          words=script["target_words"]))
        new = _validate(d, script["platform"])
    except (llm.LLMError, ValueError) as e:
        log(f"  [script] revise failed: {e}")
        return None
    out = {**script, **new}
    out["title"] = out["title_options"][0]
    return out
