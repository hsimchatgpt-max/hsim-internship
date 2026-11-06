"""Stage commands: each Claude agent runs ONE of these, on files, independently.

  validate-script  (Script Writer)    script.json  -> cleaned script.json + warnings
  fetch-broll      (Visual Director)  shots.json   -> shots.json with real downloaded clips
  render           (Video Editor)     script.json + shots.json -> final .mp4 + narration.json
  analyze          (Analyzer)         .mp4 + script.json + narration.json -> report + which agent fixes what
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

from .agents import analyzer, editor, script_writer
from .config import FPS, LANGUAGES, PLATFORMS
from .media import tts
from .media.broll import BrollSource

ROUTE = {"script": "reel-script-writer", "editor": "reel-video-editor"}


def _load(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _save(path: str | Path, data: dict) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def validate_script(a) -> int:
    raw = _load(a.file)
    platform = a.platform or raw.get("platform", "instagram")
    language = a.lang or raw.get("language", "hinglish")
    if platform not in PLATFORMS or language not in LANGUAGES:
        print(f"ERROR: platform must be one of {list(PLATFORMS)}, language one of {list(LANGUAGES)}")
        return 1
    try:
        clean = script_writer._validate(raw, platform)
    except ValueError as e:
        print(f"ERROR: script.json is invalid: {e}")
        return 1
    seconds = int(a.duration or raw.get("seconds", 30))
    clean.update(topic=raw.get("topic", ""), platform=platform, language=language, seconds=seconds,
                 target_words=int(seconds * LANGUAGES[language]["wps"]))
    clean["title"] = clean["title_options"][0]
    words = sum(len(s["voiceover"].split()) for s in clean["scenes"])
    est = words / LANGUAGES[language]["wps"]
    _save(a.file, clean)
    pf = PLATFORMS[platform]
    warn = []
    if len(clean["scenes"][0]["voiceover"].split()) > (12 if platform == "instagram" else 18):
        warn.append("hook is too long")
    if not analyzer.CTA_WORDS.search(clean["scenes"][-1]["voiceover"]):
        warn.append("last scene has no clear CTA")
    if not (pf["hashtags"][0] <= len(clean["hashtags"]) <= pf["hashtags"][1]):
        warn.append(f"hashtags should be {pf['hashtags'][0]}-{pf['hashtags'][1]}, got {len(clean['hashtags'])}")
    lo, hi = pf["ideal_sec"]
    if not lo <= est <= hi:
        warn.append(f"estimated length {est:.0f}s is outside the ideal {lo}-{hi}s")
    print(f"OK: {len(clean['scenes'])} scenes, {words} words, about {est:.0f}s spoken")
    for w in warn:
        print(f"WARNING: {w}")
    return 0


def fetch_broll(a) -> int:
    data = _load(a.shots)
    shots = data["shots"]
    src = BrollSource(a.broll_dir, a.orientation)
    got = 0
    for s in shots:
        s.setdefault("clips", [])
        s.setdefault("theme", s["scene"] % 4)
        s.setdefault("effect", ["zoom_in", "zoom_out", "pan_left", "pan_right"][s["scene"] % 4])
        if s["visual"] == "broll" and not s["clips"]:
            for _ in range(int(s.get("clip_count", 1))):
                c = src.get(s.get("query", "abstract background"))
                if c:
                    s["clips"].append(str(c))
            if s["clips"]:
                got += 1
            else:
                s["visual"] = "textcard"
    _save(a.shots, data)
    n_b = sum(1 for s in shots if s["clips"])
    print(f"OK: {n_b} scenes have real B-roll, {sum(s['visual'] == 'textcard' for s in shots)} use a text card, "
          f"{sum(s['visual'] == 'avatar' for s in shots)} use the avatar")
    if not n_b:
        print("NOTE: no B-roll found. Add PEXELS_API_KEY to .env or pass --broll-dir <folder of clips>.")
    return 0


def render(a) -> int:
    script, shots = _load(a.script), _load(a.shots)["shots"]
    platform = a.platform or script["platform"]
    language = script["language"]
    if len(shots) != len(script["scenes"]):
        print(f"ERROR: shots.json has {len(shots)} shots but script has {len(script['scenes'])} scenes; they must match 1:1")
        return 1
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    work = out / "_work" / f"{platform}_{language}"
    if a.avatar == "face":
        if not (a.face_video and Path(a.face_video).is_file()):
            print("ERROR: --avatar face needs --face-video <your recording>")
            return 1
        narr = tts.from_face_video(Path(a.face_video), script["scenes"], language, work / "voice", FPS, print)
    else:
        narr = tts.narrate(script["scenes"], language, a.gender, work / "voice", FPS, a.voice, print)
    final = out / f"{platform}_{language}.mp4"
    params = json.loads(a.params) if a.params else {}
    info = editor.edit(script, shots, narr, platform, work / "edit", final, a.avatar, a.avatar_image,
                       a.face_video, a.music, params, print)
    _save(out / f"{platform}_{language}_narration.json", {
        "words": narr.words, "windows": narr.windows, "duration": narr.duration, "source": narr.source})
    print(f"OK: rendered {final}  ({narr.duration:.1f}s, {info['cuts']} cuts, voice={narr.source})")
    if narr.source == "placeholder":
        print("WARNING: voice is a PLACEHOLDER (no internet for edge-tts). Re-run with internet for the real voice.")
    return 0


def analyze(a) -> int:
    script = _load(a.script)
    nj = _load(a.narration)
    narr = SimpleNamespace(words=[tuple(w) for w in nj["words"]], duration=nj["duration"], source=nj["source"])
    platform = a.platform or script["platform"]
    rep = analyzer.analyze(a.video, script, narr, platform)
    out = Path(a.video).with_name(Path(a.video).stem + "_analysis.json")
    _save(out, rep)
    try:
        analyzer.contact_sheet(a.video, str(Path(a.video).with_name(Path(a.video).stem + "_preview.jpg")),
                               rep["metrics"]["duration"])
    except Exception:
        pass
    print(f"SCORE: {rep['score']}/{rep['max']}  ({rep['grade']})  passed={rep['passed']}  [pass mark {analyzer.PASS_SCORE}]")
    for c in rep["checks"]:
        print(f"- {c['name']}: {c['score']}/{c['max']} | {c['message']}")
    fixes = [c for c in rep["checks"] if c["fix"]]
    if fixes:
        print("FIXES NEEDED:")
        for c in fixes:
            f = c["fix"]
            who = ROUTE[f["target"]]
            what = "; ".join(f.get("issues", [])) if f["target"] == "script" else \
                f"re-render with --params '{json.dumps(f['params'])}' ({'; '.join(f.get('issues', []))})"
            print(f"  -> {who}: {what}")
    print(f"REPORT_FILE: {out}")
    return 0
