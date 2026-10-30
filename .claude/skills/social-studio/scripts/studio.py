#!/usr/bin/env python3
"""Social Studio ko command line se chalata hai: topic do -> script/caption/hashtags + tayyar video (ya image) files milti hain.

Usage:
  python studio.py "3 website mistakes" --studio-dir /path/to/projects/social-studio --out ./output
Sirf Python ki built-in libraries use hoti hain.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def call(base, method, path, body=None, timeout=60):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            return {"_http_error": e.code, **json.loads(e.read())}
        except ValueError:
            return {"_http_error": e.code, "error": str(e)}


def fail(problem, hint, **extra):
    print(json.dumps({"ok": False, "problem": problem, "hint": hint, **extra}, ensure_ascii=False, indent=2))
    sys.exit(1)


def ensure_server(base, studio_dir):
    try:
        return call(base, "GET", "/api/setup", timeout=3)
    except (urllib.error.URLError, OSError):
        pass
    if not studio_dir or not (Path(studio_dir) / "server.py").exists():
        fail("server_not_running", "Social Studio is not running. Pass --studio-dir pointing at the folder that contains server.py, or start it with: python server.py")
    port = re.search(r":(\d+)", base.rsplit("//", 1)[-1]).group(1)
    subprocess.Popen([sys.executable, "server.py", "--no-browser"], cwd=studio_dir, env={**os.environ, "PORT": port},
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    for _ in range(30):
        time.sleep(0.5)
        try:
            return call(base, "GET", "/api/setup", timeout=3)
        except (urllib.error.URLError, OSError):
            continue
    fail("server_not_running", "Could not start Social Studio. Run `python server.py` in its folder and read the error.")


def wait_job(base, job_id, label, limit=1800):
    start, last = time.time(), ""
    while time.time() - start < limit:
        job = call(base, "GET", "/api/jobs/" + job_id)
        if job.get("_http_error"):
            return {"state": "error", "error": "The tool restarted while working. Please run again."}
        line = f"{label}: {job['stage'] or 'working'} {job['done']}/{job['total']}" if job["total"] else f"{label}: {job['stage'] or 'working'}"
        if line != last:
            print(line, file=sys.stderr)
            last = line
        if job["state"] != "running":
            return job
        time.sleep(2)
    return {"state": "error", "error": "Timed out."}


def download(base, url_path, dest):
    with urllib.request.urlopen(base + url_path, timeout=120) as resp:
        Path(dest).write_bytes(resp.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("topic", nargs="?", default="", help="what to make; empty = the AI picks a topic")
    ap.add_argument("--format", default="video", choices=["video", "image", "carousel", "story", "text"])
    ap.add_argument("--length", default="30-60 sec", choices=["15-30 sec", "30-60 sec", "60-90 sec"])
    ap.add_argument("--type", default="educational", help="educational, motivational, promotional, meme, tips, ...")
    ap.add_argument("--out", default="./social-studio-output")
    ap.add_argument("--studio-dir", default=os.environ.get("STUDIO_DIR", ""))
    ap.add_argument("--url", default="http://127.0.0.1:8000")
    ap.add_argument("--no-video", action="store_true", help="only write the text (script, caption, hashtags)")
    args = ap.parse_args()
    base = args.url.rstrip("/")

    setup = ensure_server(base, args.studio_dir)
    if not setup["ready_ai"]:
        fail("no_ai", "No AI is set up. Ask the user to open http://localhost:8000, press Setup (top right) and add a free key or install the local AI.")
    make_video = args.format in ("video", "story") and not args.no_video
    if make_video and not setup["ready_video"]:
        fail("no_video_tools", "Video tools are missing. Ask the user to open Setup and press 'Set up everything' (installs FFmpeg + voices). Retry with --no-video to get only the text.")

    made = call(base, "POST", "/api/quick", {"mode": "auto", "format": args.format, "content_type": args.type, "duration": args.length, "topic": args.topic})
    if made.get("_http_error"):
        fail("bad_request", made.get("error", "request failed"))
    post_id = made["post"]["id"]
    job = wait_job(base, made["job"], "writing")
    if job["state"] != "done":  # user ke "Try again" jaisa: aaram (cooldown) bhool kar ek aur koshish
        retry = call(base, "POST", f"/api/posts/{post_id}/generate", {"step": "all", "force": True})
        job = wait_job(base, retry["job"], "writing (retry)")
    if job["state"] != "done":
        fail("ai_failed", "The AI could not write the content. Free AI limits may be used up: wait, or add OpenRouter / the local AI in Setup.", detail=job["error"])

    if make_video:
        started = call(base, "POST", f"/api/posts/{post_id}/video", {"auto": True})
        if started.get("_http_error"):
            fail("video_failed", started.get("error", "could not start the video"))
        job = wait_job(base, started["job"], "video")
        if job["state"] != "done":
            fail("video_failed", "The video could not be made.", detail=job["error"])

    post = call(base, "GET", f"/api/posts/{post_id}")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    files = []
    if post["video"]:
        download(base, f"/videos/{post['video']}", out / post["video"])
        files.append(str((out / post["video"]).resolve()))
    for name in post["images"]:
        download(base, f"/files/{name}", out / name)
        files.append(str((out / name).resolve()))
    text = out / f"{Path(post['video'] or 'content').stem}-text.txt"
    text.write_text("\n".join(["CAPTION", post["caption"], "", "HASHTAGS", post["hashtags"], "", "CTA", post["cta"], "", "SCRIPT", post["script"]]), encoding="utf-8")
    files.append(str(text.resolve()))
    print(json.dumps({"ok": True, "topic": post["topic"], "files": files, "caption": post["caption"], "hashtags": post["hashtags"],
                      "hook": post["hook"], "script": post["script"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
