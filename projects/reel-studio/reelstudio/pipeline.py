"""Orchestrator: runs the four agents in order and loops back when the analyzer finds weak spots."""
from __future__ import annotations

import hashlib
import json
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from . import llm
from .agents import analyzer, editor, script_writer, visual_director
from .config import FPS, PLATFORMS
from .media import tts


@dataclass
class Options:
    topic: str
    platforms: list[str] = field(default_factory=lambda: ["instagram", "linkedin"])
    languages: list[str] = field(default_factory=lambda: ["hinglish"])
    seconds: int = 30
    avatar: str = "ai"                       # none | ai | face
    avatar_image: str | None = None
    face_video: str | None = None
    gender: str = "female"
    voice: str | None = None
    broll_dir: str | None = None
    music: str | None = None
    out: str = "output"
    max_fixes: int = 2
    keep_work: bool = False


def slugify(topic: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", topic.lower()).strip("-")[:40]
    return s or "video-" + hashlib.sha1(topic.encode()).hexdigest()[:6]


def _apply_fixes(report: dict, params: dict) -> tuple[dict, list[str], bool]:
    """-> (new editor params, script issues, anything_changed)"""
    new, issues, changed = dict(params), [], False
    for c in report["checks"]:
        fx = c["fix"]
        if not fx:
            continue
        if fx["target"] == "editor":
            for k, v in fx["params"].items():
                new[k] = round(new.get(k, 1.0) * v, 3)
                changed = True
        else:
            issues += fx["issues"]
    return new, issues, changed


def build_one(o: Options, platform: str, language: str, outdir: Path, shared_script: dict | None, log) -> dict:
    pf = PLATFORMS[platform]
    tag = f"{platform}_{language}"
    work = outdir / "_work" / tag
    work.mkdir(parents=True, exist_ok=True)
    final = outdir / f"{tag}.mp4"
    W, H = pf["size"]
    orientation = "portrait" if H > W * 1.2 else "square"

    log(f"\n=== {pf['label']} | {language} ===")
    log("[1/4] Script Writer")
    script = shared_script or script_writer.write(o.topic, platform, language, o.seconds, log)
    if shared_script:
        script = {**shared_script, "platform": platform}
    log(f"  title: {script['title']}  ({len(script['scenes'])} scenes)")

    def make_voice(sc: dict):
        if o.avatar == "face":
            return tts.from_face_video(Path(o.face_video), sc["scenes"], language, work / "voice", FPS, log)
        return tts.narrate(sc["scenes"], language, o.gender, work / "voice", FPS, o.voice, log)

    log("[2/4] Voice + Visual Director")
    narr = make_voice(script)
    log(f"  voice: {narr.source}, {narr.duration:.1f}s")
    shots = visual_director.plan(script, o.avatar, o.broll_dir, orientation, log)

    params: dict = {}
    best = None
    for rnd in range(o.max_fixes + 1):
        log(f"[3/4] Video Editor (pass {rnd + 1})")
        info = editor.edit(script, shots, narr, platform, work / "edit", final, o.avatar, o.avatar_image,
                           o.face_video, o.music, params, log)
        log("[4/4] Analyzer")
        report = analyzer.analyze(str(final), script, narr, platform)
        log(f"  score {report['score']}/{report['max']} - {report['grade']}")
        for c in report["checks"]:
            log(f"   - {c['name']}: {c['score']}/{c['max']}  {c['message']}")
        if best is None or report["score"] >= best["report"]["score"]:
            best = {"report": report, "script": script, "info": info}
            shutil.copy(final, work / "best.mp4")
        if report["passed"] or rnd == o.max_fixes:
            break
        params2, issues, changed = _apply_fixes(report, params)
        script_changed = False
        if issues and o.avatar != "face":
            new = script_writer.revise(script, issues, log)
            if new:
                script, script_changed = new, True
                narr = make_voice(script)
                shots = visual_director.plan(script, o.avatar, o.broll_dir, orientation, log)
            else:
                log("  (script fixes need an LLM key; skipped: " + "; ".join(issues) + ")")
        elif issues:
            log("  (script fixes skipped: your recorded face video can't change; " + "; ".join(issues) + ")")
        if not changed and not script_changed:
            log("  nothing more the agents can fix automatically")
            break
        params = params2
        log(f"  -> sending back for fixes (editor params {params}, script rewrite: {script_changed})")

    shutil.copy(work / "best.mp4", final)
    report = best["report"]
    script = best["script"]
    sheet = outdir / f"{tag}_preview.jpg"
    try:
        analyzer.contact_sheet(str(final), str(sheet), report["metrics"]["duration"])
    except Exception:
        sheet = None
    (outdir / f"{tag}_analysis.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    post = (
        f"TITLE OPTIONS\n" + "\n".join(f"  {i + 1}. {t}" for i, t in enumerate(script["title_options"])) +
        f"\n\nCAPTION\n{script['caption']}\n\n{' '.join(script['hashtags'])}\n\nSCRIPT\n" +
        "\n".join(f"  [{s['role']}] {s['voiceover']}   <{s['on_screen_text']}>" for s in script["scenes"]) + "\n")
    (outdir / f"{tag}_post.txt").write_text(post, encoding="utf-8")
    if not o.keep_work:
        shutil.rmtree(work, ignore_errors=True)
    return {"tag": tag, "label": pf["label"], "video": str(final), "report": report, "script": script,
            "voice": best["info"]["voice_source"], "preview": str(sheet) if sheet else None}


def run(o: Options, log=print) -> Path:
    if o.avatar == "face" and not (o.face_video and Path(o.face_video).is_file()):
        raise SystemExit("--avatar face needs --face-video path/to/your_recording.mp4 "
                         "(record yourself reading the script, speak right from the first second)")
    outdir = Path(o.out) / slugify(o.topic)
    outdir.mkdir(parents=True, exist_ok=True)
    log(f"Topic: {o.topic}\nLLM: {llm.provider_name() or 'offline template'} | avatar: {o.avatar} | out: {outdir}")
    results, shared = [], None
    for language in o.languages:
        shared = None
        for platform in o.platforms:
            r = build_one(o, platform, language, outdir, shared, log)
            if o.avatar == "face":
                shared = r["script"]
            results.append(r)
    _write_report(outdir, o, results)
    log(f"\nDONE -> {outdir}\n  open REPORT.md for scores; videos are ready to upload.")
    return outdir


def _write_report(outdir: Path, o: Options, results: list[dict]) -> None:
    L = [f"# Reel Studio report: {o.topic}", ""]
    warn = [r for r in results if r["voice"] == "placeholder"]
    if warn:
        L += ["> WARNING: voice was a PLACEHOLDER (no internet for edge-tts). Re-run with internet for the real voice.", ""]
    for r in results:
        rep = r["report"]
        L += [f"## {r['label']} ({r['tag']}): {rep['score']}/{rep['max']} - {rep['grade']}", "",
              f"File: `{Path(r['video']).name}`  |  copy/caption: `{r['tag']}_post.txt`", "",
              "| Check | Score | Details |", "|---|---|---|"]
        L += [f"| {c['name']} | {c['score']}/{c['max']} | {c['message']} |" for c in rep["checks"]]
        todo = [i for c in rep["checks"] if c["fix"] for i in c["fix"].get("issues", [])]
        if todo:
            L += ["", "**Still weak:** " + "; ".join(todo)]
        L.append("")
    (outdir / "REPORT.md").write_text("\n".join(L), encoding="utf-8")
