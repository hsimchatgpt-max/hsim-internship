"""Agent 2 - Visual Director: decides, per scene, what the viewer SEES (avatar / B-roll / text card),
and fetches the footage. Output is a shot list the editor follows."""
from __future__ import annotations

import re

from .. import llm
from ..media.broll import BrollSource

STOP = set("the a an and or of to in on for with is are was were be this that it your you we they i at by from as "
           "not no do does did can will just very more most each every one two three ke ki ka hai hain se ko mein "
           "me aur ya par ye wo kya nahi hum aap jo to bhi ek".split())

SYSTEM = ("You are a short-form video art director. For each scene, give 2 concrete ENGLISH search keywords "
          "for stock footage (visual, filmable things: 'person typing laptop', not abstract ideas).")


def _keywords(text: str, topic: str) -> str:
    words = [w for w in re.findall(r"[A-Za-z]{3,}", text.lower()) if w not in STOP]
    topic_words = [w for w in re.findall(r"[A-Za-z]{3,}", topic.lower()) if w not in STOP]
    picks = (words[:2] or []) + (topic_words[:1] or [])
    return " ".join(dict.fromkeys(picks)) or "abstract background"


def _queries(script: dict, log) -> list[str]:
    scenes = script["scenes"]
    fallback = [_keywords(s["voiceover"] + " " + s["on_screen_text"], script["topic"]) for s in scenes]
    if not llm.available():
        return fallback
    try:
        d = llm.chat_json(SYSTEM, (
            f"Video topic: {script['topic']}\nScenes:\n" +
            "\n".join(f"{i + 1}. {s['voiceover']}" for i, s in enumerate(scenes)) +
            '\nReturn {"queries": ["keywords for scene 1", ...]} with exactly one entry per scene.'), 0.4)
        q = [str(x) for x in d.get("queries", [])]
        return q if len(q) == len(scenes) else fallback
    except llm.LLMError as e:
        log(f"  [visual] keyword LLM failed ({e}); using simple keywords")
        return fallback


def plan(script: dict, avatar: str, broll_dir: str | None, orientation: str, log=print) -> list[dict]:
    """avatar: none | ai | face. Returns one shot per scene."""
    queries = _queries(script, log)
    src = BrollSource(broll_dir, orientation, log)
    shots = []
    for i, sc in enumerate(script["scenes"]):
        role = sc["role"]
        # Human on screen for the hook (attention) and the CTA (trust); B-roll in between,
        # with the avatar returning every 3rd scene so the viewer keeps a "person" anchor.
        if avatar != "none" and (role in ("hook", "cta") or i % 3 == 0):
            visual = "avatar"
        else:
            visual = "broll"
        shot = {"scene": i, "role": role, "visual": visual, "query": queries[i], "clips": [], "theme": i % 4,
                "effect": ["zoom_in", "zoom_out", "pan_left", "pan_right"][i % 4]}
        if visual == "broll":
            need = 2 if len(sc["voiceover"].split()) > 14 else 1       # long scenes get 2 clips -> faster cuts
            for _ in range(need):
                clip = src.get(queries[i])
                if clip:
                    shot["clips"].append(str(clip))
            if not shot["clips"]:
                shot["visual"] = "textcard"                              # graceful fallback, never a blank screen
        shots.append(shot)
    n_b = sum(1 for s in shots if s["clips"])
    log(f"  [visual] {len(shots)} scenes: {sum(s['visual'] == 'avatar' for s in shots)} avatar, "
        f"{n_b} B-roll, {sum(s['visual'] == 'textcard' for s in shots)} text-card"
        + ("" if n_b or avatar == 'none' and not any(s['visual'] == 'textcard' for s in shots) else
           "  (add PEXELS_API_KEY or --broll-dir for real footage)"))
    return shots
