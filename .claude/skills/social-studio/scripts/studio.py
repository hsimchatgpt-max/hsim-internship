#!/usr/bin/env python3
"""Social Studio ko command line se chalata hai. Har agent ke liye alag command:

  status    tool taiyar hai? (AI, video tools, avatars, brand profile)
  script    Script Writer agent ka likha script tool me jama karta hai (aur jaanchta hai)
  edit      Editor agent: video banwata hai, preview frames nikalta hai
  deliver   Delivery agent: video + caption + hashtags + thumbnail ek folder me rakhta hai
  make      sab ek saath (topic do, tayyar video lo; tool ka apna AI script likhta hai)

Sirf Python ki built-in libraries use hoti hain. Har command ke aakhir me ek JSON chhapta hai.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import date
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


def out(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def fail(problem, hint, **extra):
    out({"ok": False, "problem": problem, "hint": hint, **extra})
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


def wait_job(base, job_id, label, limit=2400):
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
    with urllib.request.urlopen(base + url_path, timeout=300) as resp:
        Path(dest).write_bytes(resp.read())


def find_ffmpeg(studio_dir):
    exe = ".exe" if os.name == "nt" else ""
    for cand in [Path(studio_dir or ".") / "data" / "bin" / f"ffmpeg{exe}", shutil.which("ffmpeg")]:
        if cand and Path(cand).exists():
            return str(cand)
    return None


def grab_frames(ffmpeg, video, folder, stamps):
    """Video se kuch frames (JPG) nikalta hai, taaki Editor agent unhe dekhkar quality check kar sake."""
    Path(folder).mkdir(parents=True, exist_ok=True)
    made = []
    for name, sec in stamps:
        dest = Path(folder) / f"{name}.jpg"
        r = subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-ss", str(sec), "-i", str(video), "-frames:v", "1", "-vf", "scale=540:-1", str(dest)],
                           capture_output=True)
        if r.returncode == 0 and dest.exists():
            made.append(str(dest.resolve()))
    return made


def probe(ffmpeg, video):
    ffprobe = str(Path(ffmpeg).with_name(Path(ffmpeg).name.replace("ffmpeg", "ffprobe")))
    r = subprocess.run([ffprobe, "-v", "error", "-show_entries", "stream=codec_type,width,height,duration", "-of", "json", str(video)], capture_output=True, text=True)
    try:
        streams = json.loads(r.stdout)["streams"]
    except (ValueError, KeyError):
        return {}
    v = next((s for s in streams if s["codec_type"] == "video"), {})
    a = next((s for s in streams if s["codec_type"] == "audio"), {})
    return {"width": v.get("width"), "height": v.get("height"), "video_seconds": float(v.get("duration", 0) or 0),
            "has_audio": bool(a), "audio_seconds": float(a.get("duration", 0) or 0)}


# ---------------- commands ----------------

def cmd_status(a, base):
    setup = ensure_server(base, a.studio_dir)
    cfg = call(base, "GET", "/api/config")
    out({"ok": True, "ready_ai": setup["ready_ai"], "ready_video": setup["ready_video"], "pexels_broll": cfg.get("has_pexels", False),
         "brand": cfg["brand"], "avatars": [{"id": x["id"], "name": x["name"], "gender": x["gender"], "kind": x["kind"]} for x in call(base, "GET", "/api/avatars")],
         "own_media_files": len(call(base, "GET", "/api/media")), "providers": {k: v["ready"] for k, v in setup["providers"].items()}})


def cmd_script(a, base):
    ensure_server(base, a.studio_dir)
    script = Path(a.script_file).read_text(encoding="utf-8")
    check = call(base, "POST", "/api/script/check", {"script": script, "duration": a.length})
    body = {"date": date.today().isoformat(), "format": "video", "content_type": a.type, "topic": a.topic, "platforms": [a.platform], "duration": a.length,
            "hook": a.hook or (check["list"][0]["spoken"] if check.get("list") else ""), "caption": a.caption or "", "hashtags": a.hashtags or "",
            "cta": a.cta or "", "script": script, "status": "draft"}
    if a.caption_file:
        body["caption"] = Path(a.caption_file).read_text(encoding="utf-8").strip()
    saved = call(base, "PUT", f"/api/posts/{a.post}", body) if a.post else call(base, "POST", "/api/posts", body)
    if saved.get("_http_error"):
        fail("bad_request", saved.get("error", "could not save the script"))
    out({"ok": True, "post_id": saved["id"], "scenes": check.get("scenes"), "approx_seconds": check.get("approx_seconds"),
         "problems": check.get("problems", []), "hint": "If problems is not empty, fix the script and run this command again with --post " + str(saved["id"])})


def cmd_edit(a, base):
    setup = ensure_server(base, a.studio_dir)
    if not setup["ready_video"]:
        fail("no_video_tools", "FFmpeg or voices are missing. The user must open http://localhost:8000, press Setup, then 'Set up everything'.")
    post = call(base, "GET", f"/api/posts/{a.post}")
    if post.get("_http_error"):
        fail("post_not_found", f"No post with id {a.post}. Run the script step first.")
    started = call(base, "POST", f"/api/posts/{a.post}/video", {"avatar": a.avatar, "music": a.music, "quality": a.quality, "voice": a.voice})
    if started.get("_http_error"):
        fail("video_failed", started.get("error", "could not start the video"))
    job = wait_job(base, started["job"], "editing")
    if job["state"] != "done":
        fail("video_failed", "The video could not be made.", detail=job["error"])
    post = call(base, "GET", f"/api/posts/{a.post}")
    work = Path(a.out)
    work.mkdir(parents=True, exist_ok=True)
    video = work / post["video"]
    download(base, f"/videos/{post['video']}", video)
    info, frames, ffmpeg = {}, [], find_ffmpeg(a.studio_dir)
    if ffmpeg:
        info = probe(ffmpeg, video)
        total = info.get("video_seconds") or 10
        frames = grab_frames(ffmpeg, video, work / "frames", [("start", 0.8), ("quarter", total * 0.25), ("middle", total * 0.5), ("three-quarter", total * 0.75), ("end", max(0.5, total - 1.5))])
    out({"ok": True, "post_id": a.post, "video": str(video.resolve()), "info": info, "frames_to_review": frames,
         "hint": "Look at the frames (Read tool). Check captions are readable, text is not cut off, the avatar does not cover captions."})


def cmd_deliver(a, base):
    ensure_server(base, a.studio_dir)
    post = call(base, "GET", f"/api/posts/{a.post}")
    if post.get("_http_error") or not post.get("video"):
        fail("no_video", "This post has no finished video yet. Run the edit step first.")
    slug = re.sub(r"[^a-z0-9]+", "-", post["topic"].lower()).strip("-")[:40] or "reel"
    folder = Path(a.out) / f"{date.today().isoformat()}-{slug}"
    folder.mkdir(parents=True, exist_ok=True)
    video = folder / f"{slug}.mp4"
    download(base, f"/videos/{post['video']}", video)
    files = [str(video.resolve())]
    ffmpeg = find_ffmpeg(a.studio_dir)
    if ffmpeg:
        thumb = grab_frames(ffmpeg, video, folder, [("thumbnail", 1.0)])
        files += thumb
    platform = (post["platforms"] or ["instagram"])[0]
    limits = {"instagram": "Reels: up to 90 seconds, 9:16. Caption up to 2,200 characters. 5 to 8 hashtags work best.",
              "youtube": "Shorts: up to 60 seconds, 9:16. Put the main keyword in the title. 3 to 5 hashtags.",
              "linkedin": "Video: 9:16 or square works. First line of the caption is what people see before 'see more'. 3 to 5 hashtags."}[platform]
    (folder / "post-ready.txt").write_text("\n".join([post["caption"], "", post["hashtags"], "", post["cta"]]).strip() + "\n", encoding="utf-8")
    (folder / "how-to-post.md").write_text(
        f"# {post['topic']}\n\nPlatform: {platform}\n\n1. Open {platform} on your phone or browser and start a new post / upload.\n"
        f"2. Upload `{video.name}`.\n3. Paste the text from `post-ready.txt` as the caption.\n4. Choose a cover (`thumbnail.jpg` is a good one).\n"
        f"5. Add trending audio inside the app only if you want it (it cannot be added outside Instagram).\n\n{limits}\n", encoding="utf-8")
    files += [str((folder / "post-ready.txt").resolve()), str((folder / "how-to-post.md").resolve())]
    out({"ok": True, "folder": str(folder.resolve()), "files": files, "caption": post["caption"], "hashtags": post["hashtags"], "platform": platform})


def cmd_make(a, base):
    setup = ensure_server(base, a.studio_dir)
    if not setup["ready_ai"]:
        fail("no_ai", "No AI is set up in the tool. Ask the user to open http://localhost:8000, press Setup and add a free key. (Or use the script/edit/deliver agents: then Claude writes the script itself.)")
    made = call(base, "POST", "/api/quick", {"mode": "auto", "format": a.format, "content_type": a.type, "duration": a.length, "topic": a.topic, "avatar": a.avatar})
    if made.get("_http_error"):
        fail("bad_request", made.get("error", "request failed"))
    post_id = made["post"]["id"]
    job = wait_job(base, made["job"], "writing")
    if job["state"] != "done":
        retry = call(base, "POST", f"/api/posts/{post_id}/generate", {"step": "all", "force": True})
        job = wait_job(base, retry["job"], "writing (retry)")
    if job["state"] != "done":
        fail("ai_failed", "The tool's free AI could not write the content (limits). Use the Script Writer agent instead: Claude writes the script itself.", detail=job["error"])
    a.post = post_id
    if a.format in ("video", "story") and not a.no_video:
        cmd_edit(argparse.Namespace(**{**vars(a), "music": "ambient", "quality": "high", "voice": ""}), base)
        return
    post = call(base, "GET", f"/api/posts/{post_id}")
    out({"ok": True, "post_id": post_id, "caption": post["caption"], "hashtags": post["hashtags"], "script": post["script"]})


def main():
    argv = sys.argv[1:]
    if argv and argv[0] not in ("status", "script", "edit", "deliver", "make", "-h", "--help"):
        argv = ["make"] + argv  # purana tareeka: studio.py "topic"
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--studio-dir", default=os.environ.get("STUDIO_DIR", ""))
        p.add_argument("--url", default="http://127.0.0.1:8000")
        return p

    common(sub.add_parser("status"))
    p = common(sub.add_parser("script"))
    p.add_argument("--topic", required=True)
    p.add_argument("--script-file", required=True, help="text file with the scenes: Scene N: <line> [on-screen text: ..] [broll: ..] [emotion: ..]")
    p.add_argument("--platform", default="instagram", choices=["instagram", "youtube", "linkedin"])
    p.add_argument("--length", default="30-60 sec", choices=["15-30 sec", "30-60 sec", "60-90 sec"])
    p.add_argument("--type", default="educational")
    p.add_argument("--hook", default="")
    p.add_argument("--caption", default="")
    p.add_argument("--caption-file", default="")
    p.add_argument("--hashtags", default="")
    p.add_argument("--cta", default="")
    p.add_argument("--post", type=int, default=0, help="update an existing post instead of creating a new one")
    p = common(sub.add_parser("edit"))
    p.add_argument("--post", type=int, required=True)
    p.add_argument("--avatar", default="", help="avatar id (see status), empty = no avatar")
    p.add_argument("--music", default="ambient", help="ambient | none | a file name from the tool's music list")
    p.add_argument("--quality", default="high", choices=["high", "standard"], help="high = 1080x1920, standard = 720p (faster)")
    p.add_argument("--voice", default="", help="empty = automatic (matches the avatar)")
    p.add_argument("--out", default="./reel-work")
    p = common(sub.add_parser("deliver"))
    p.add_argument("--post", type=int, required=True)
    p.add_argument("--out", default="./reels-output")
    p = common(sub.add_parser("make"))
    p.add_argument("topic", nargs="?", default="")
    p.add_argument("--format", default="video", choices=["video", "image", "carousel", "story", "text"])
    p.add_argument("--length", default="30-60 sec", choices=["15-30 sec", "30-60 sec", "60-90 sec"])
    p.add_argument("--type", default="educational")
    p.add_argument("--avatar", default="")
    p.add_argument("--out", default="./reel-work")
    p.add_argument("--no-video", action="store_true")
    a = ap.parse_args(argv)
    base = a.url.rstrip("/")
    {"status": cmd_status, "script": cmd_script, "edit": cmd_edit, "deliver": cmd_deliver, "make": cmd_make}[a.cmd](a, base)


if __name__ == "__main__":
    main()
