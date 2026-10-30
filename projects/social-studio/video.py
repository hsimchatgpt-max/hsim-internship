"""Free video engine: voice (TTS) + scene images -> edited MP4 with FFmpeg.

Sirf Python ki built-in libraries use hui hain. Bahar ke tools:
  - FFmpeg (zaroori; Settings se download ho jata hai)
  - edge-tts (optional, behtar voices; `pip install edge-tts`), warna computer ki apni voice
"""
import asyncio
import importlib
import os
import platform
import re
import shutil
import subprocess
import sys
import textwrap
import urllib.request
import zipfile
from pathlib import Path

NO_WINDOW = 0x08000000 if platform.system() == "Windows" else 0
FFMPEG_URLS = [
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
]
TRANSITIONS = ["fade", "slideleft", "circleopen", "wipeleft", "fadeblack", "smoothleft", "slideup", "dissolve"]
TRANSITION_SECS = 0.5
PAD_SECS = 0.35  # har scene ki bolne ke baad chhoti si khamoshi

EDGE_VOICES = [  # (id, label, language group)
    ("hi-IN-SwaraNeural", "Hindi - Swara (female)", "hi"), ("hi-IN-MadhurNeural", "Hindi - Madhur (male)", "hi"),
    ("en-IN-NeerjaNeural", "English (India) - Neerja (female)", "en"), ("en-IN-PrabhatNeural", "English (India) - Prabhat (male)", "en"),
    ("en-US-JennyNeural", "English (US) - Jenny (female)", "en"), ("en-US-GuyNeural", "English (US) - Guy (male)", "en"),
    ("en-GB-SoniaNeural", "English (UK) - Sonia (female)", "en"), ("ur-IN-GulNeural", "Urdu - Gul (female)", "ur"),
    ("bn-IN-TanishaaNeural", "Bengali - Tanishaa (female)", "bn"), ("ta-IN-PallaviNeural", "Tamil - Pallavi (female)", "ta"),
    ("te-IN-ShrutiNeural", "Telugu - Shruti (female)", "te"), ("mr-IN-AarohiNeural", "Marathi - Aarohi (female)", "mr"),
    ("gu-IN-DhwaniNeural", "Gujarati - Dhwani (female)", "gu"),
]


class VideoError(Exception):
    pass


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, creationflags=NO_WINDOW, **kw)


# ---------- FFmpeg ----------

def find_ffmpeg(data_dir):
    """(ffmpeg, ffprobe) ka path, ya None."""
    exe = ".exe" if platform.system() == "Windows" else ""
    local = Path(data_dir) / "bin"
    for folder in (local, None):
        ff = str(local / f"ffmpeg{exe}") if folder else shutil.which("ffmpeg")
        fp = str(local / f"ffprobe{exe}") if folder else shutil.which("ffprobe")
        if ff and fp and Path(ff).exists() and Path(fp).exists():
            return ff, fp
    return None


def download_ffmpeg(data_dir, progress):
    """Windows par FFmpeg khud download karta hai. Mac/Linux par instruction deta hai."""
    system = platform.system()
    if system != "Windows":
        cmd = "brew install ffmpeg" if system == "Darwin" else "sudo apt install ffmpeg"
        raise VideoError(f"Please install FFmpeg yourself: run `{cmd}` in the Terminal, then restart the tool.")
    bin_dir = Path(data_dir) / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    zip_path = bin_dir / "ffmpeg.zip"
    last_error = ""
    for url in FFMPEG_URLS:
        try:
            with urllib.request.urlopen(url, timeout=60) as resp, open(zip_path, "wb") as out:
                total, done = int(resp.headers.get("Content-Length") or 0), 0
                while chunk := resp.read(1 << 20):
                    out.write(chunk)
                    done += len(chunk)
                    if total:
                        progress(done, total)
            break
        except OSError as e:
            last_error = str(e)
    else:
        raise VideoError(f"Could not download FFmpeg ({last_error}). Check your internet connection.")
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            base = name.rsplit("/", 1)[-1]
            if base in ("ffmpeg.exe", "ffprobe.exe"):
                (bin_dir / base).write_bytes(z.read(name))
    zip_path.unlink(missing_ok=True)
    if not find_ffmpeg(data_dir):
        raise VideoError("FFmpeg download finished but the files were not found.")


# ---------- voices ----------

def edge_available():
    try:
        import edge_tts  # noqa: F401
        return True
    except ImportError:
        return False


def install_edge():
    """edge-tts ko isi Python me pip se install karta hai."""
    r = run([sys.executable, "-m", "pip", "install", "--upgrade", "edge-tts"])
    importlib.invalidate_caches()
    if r.returncode != 0 or not edge_available():
        raise VideoError("Could not install the better voices (edge-tts). The computer's own voices will be used instead. "
                         + (r.stderr or "")[-200:])


def system_voices():
    """Computer ki apni voices (bina internet / install ke)."""
    system = platform.system()
    out = []
    try:
        if system == "Windows":
            ps = "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; " \
                 "$s.GetInstalledVoices() | % { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name }"
            for line in run(["powershell", "-NoProfile", "-Command", ps]).stdout.splitlines():
                if "|" in line:
                    name, culture = line.strip().split("|", 1)
                    out.append(("sys:" + name, f"{name} (this computer)", culture.split("-")[0].lower()))
        elif system == "Darwin":
            for line in run(["say", "-v", "?"]).stdout.splitlines():
                m = re.match(r"(.+?)\s{2,}(\w+)", line)
                if m:
                    out.append(("sys:" + m.group(1).strip(), f"{m.group(1).strip()} (this computer)", m.group(2)[:2].lower()))
        elif shutil.which("espeak-ng"):
            out.append(("sys:en", "English (this computer)", "en"))
    except OSError:
        pass
    return out


def list_voices():
    voices = [{"id": "edge:" + i, "label": label, "lang": lang} for i, label, lang in EDGE_VOICES] if edge_available() else []
    voices += [{"id": i, "label": label, "lang": lang} for i, label, lang in system_voices()]
    return voices


def default_voice(language, voices):
    """Brand language ke hisaab se voice. Hinglish (Roman Hindi) ke liye Indian English voice behtar padhti hai."""
    wanted = ["hi-IN-SwaraNeural", "hi"] if language == "hindi" else ["en-IN-NeerjaNeural", "en"]
    for v in voices:
        if v["id"] == "edge:" + wanted[0]:
            return v["id"]
    for v in voices:
        if v["lang"] == wanted[1]:
            return v["id"]
    return voices[0]["id"] if voices else ""


def synth(text, voice, out_path, ffmpeg):
    """Text ko bolkar audio file (out_path) me save karta hai."""
    out_path = str(out_path)
    if os.environ.get("SOCIAL_STUDIO_MOCK_TTS") == "1":  # sirf testing: nakli awaaz (tone)
        secs = max(1.2, len(text) / 14)
        r = run([ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"sine=f=220:d={secs}", out_path])
        if r.returncode:
            raise VideoError(r.stderr[-300:])
        return
    kind, _, name = voice.partition(":")
    try:
        if kind == "edge":
            import edge_tts
            asyncio.run(edge_tts.Communicate(text, name).save(out_path))
        elif kind == "sys":
            system_speak(text, name, out_path, ffmpeg)
        else:
            raise VideoError("No voice is available. Open Settings and install the voice engine.")
    except VideoError:
        raise
    except Exception as e:  # network / service error
        raise VideoError(f"Voice generation failed: {str(e)[:200]}")
    if not Path(out_path).exists() or Path(out_path).stat().st_size < 100:
        raise VideoError("Voice generation produced no audio.")


def system_speak(text, name, out_path, ffmpeg):
    system = platform.system()
    tmp_txt = Path(out_path).with_suffix(".txt")
    tmp_txt.write_text(text, encoding="utf-8")
    raw = Path(out_path).with_suffix(".sysraw.wav" if system == "Windows" else ".sysraw.aiff")
    if system == "Windows":
        ps = ("Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; "
              "if ($env:SS_VOICE) { $s.SelectVoice($env:SS_VOICE) }; $s.SetOutputToWaveFile($env:SS_OUT); "
              "$s.Speak((Get-Content -Raw -Encoding UTF8 $env:SS_TXT)); $s.Dispose()")
        r = run(["powershell", "-NoProfile", "-Command", ps], env={**os.environ, "SS_VOICE": name, "SS_OUT": str(raw), "SS_TXT": str(tmp_txt)})
    elif system == "Darwin":
        r = run(["say", "-v", name, "-o", str(raw), "-f", str(tmp_txt)])
    else:
        r = run(["espeak-ng", "-v", name or "en", "-f", str(tmp_txt), "-w", str(raw)])
    if r.returncode or not raw.exists():
        raise VideoError("The computer's own voice failed: " + (r.stderr or "")[-200:])
    c = run([ffmpeg, "-y", "-loglevel", "error", "-i", str(raw), str(out_path)])
    if c.returncode:
        raise VideoError(c.stderr[-300:])


def duration(ffprobe, path):
    r = run([ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)])
    try:
        return float(r.stdout.strip())
    except ValueError:
        raise VideoError("Could not read the audio length.")


# ---------- editing ----------

def make_whoosh(ffmpeg, path):
    if Path(path).exists():
        return
    r = run([ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anoisesrc=d=0.7:c=pink:a=0.6", "-af",
             "bandpass=f=1300:width_type=h:w=2200,afade=t=in:d=0.3,afade=t=out:st=0.3:d=0.4,volume=0.8", str(path)])
    if r.returncode:
        raise VideoError(r.stderr[-300:])


AMBIENT = ("aevalsrc='0.5*sin(2*PI*196*t)+0.4*sin(2*PI*246.9*t)+0.35*sin(2*PI*293.7*t)+0.25*sin(2*PI*392*t)':d={d}:s=44100,"
           "tremolo=f=0.2:d=0.5,lowpass=f=1200")


def compose(ffmpeg, scenes, out_path, music, height, sfx, progress, captions=None):
    """
    scenes: [{"audio", "slot", and either "image" (opaque card)  or  "bg" + "bg_kind" ("image"|"video") + "overlay" (transparent card)}]
    captions: [{"start", "end", "textfile", "font"}]  reel-style captions (2-3 shabd, bade pile akshar)
    music: None | "ambient" | path ; height: 1280 (HD) ya 1920 (full HD) ; sfx: whoosh file ya None
    """
    n, T = len(scenes), TRANSITION_SECS
    width = height * 9 // 16
    total = sum(s["slot"] for s in scenes)
    inputs, filters, count = [], [], [0]

    def add(*args):  # input jodta hai, uska index lautata hai
        inputs.extend(args)
        count[0] += 1
        return count[0] - 1

    ow, oh = int(width * 1.06) // 2 * 2, int(height * 1.06) // 2 * 2
    for i, s in enumerate(scenes):
        dur = s["slot"] + (T if i < n - 1 else 0.0)
        d = f"{dur:.3f}"
        x = f"(in_w-out_w)*t/{d}" if i % 2 == 0 else f"(in_w-out_w)*(1-t/{d})"  # pan: left->right, phir right->left
        if s.get("bg") and s.get("bg_kind") == "video":
            b = add("-stream_loop", "-1", "-t", d, "-i", s["bg"])
            filters.append(f"[{b}:v]setpts=PTS-STARTPTS,scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},"
                           f"fps=30,eq=brightness=-0.2,format=yuv420p,setsar=1[b{i}]")
        elif s.get("bg"):
            b = add("-loop", "1", "-framerate", "30", "-t", d, "-i", s["bg"])
            filters.append(f"[{b}:v]scale={ow}:{oh}:force_original_aspect_ratio=increase,crop={width}:{height}:x='{x}':y='(in_h-out_h)/2',"
                           f"fps=30,eq=brightness=-0.2,format=yuv420p,setsar=1[b{i}]")
        else:
            b = add("-loop", "1", "-framerate", "30", "-t", d, "-i", s["image"])
            filters.append(f"[{b}:v]scale={ow}:{oh}:force_original_aspect_ratio=increase,crop={width}:{height}:x='{x}':y='(in_h-out_h)/2',"
                           f"fps=30,format=yuv420p,setsar=1[v{i}]")
        if s.get("bg"):
            o = add("-loop", "1", "-framerate", "30", "-t", d, "-i", s["overlay"])
            filters.append(f"[{o}:v]fps=30,format=rgba[o{i}]")
            filters.append(f"[b{i}][o{i}]overlay=0:0:shortest=1,format=yuv420p,setsar=1[v{i}]")
    audio_idx = [add("-i", s["audio"]) for s in scenes]
    # video: xfade chain
    last, offset = "v0", 0.0
    for k in range(1, n):
        offset += scenes[k - 1]["slot"]
        filters.append(f"[{last}][v{k}]xfade=transition={TRANSITIONS[(k - 1) % len(TRANSITIONS)]}:duration={T}:offset={offset:.3f}[x{k}]")
        last = f"x{k}"
    if captions:  # reel-style captions: pile akshar, kaala border, awaaz ke saath badalte hue
        fs = int(width * 0.078)
        chain = [f"drawtext=fontfile='{_filter_path(c['font'])}':textfile='{_filter_path(c['textfile'])}':fontsize={fs}:fontcolor=0xFFD400:"
                 f"borderw={max(3, int(fs * 0.09))}:bordercolor=black:x=(w-text_w)/2:y=h*0.64:enable='between(t,{c['start']:.2f},{c['end']:.2f})'"
                 for c in captions]
        filters.append(f"[{last}]" + ",".join(chain) + "[vcap]")
        last = "vcap"
    video_label = last
    # voice: har scene ko slot tak pad karke jodo
    for i, s in enumerate(scenes):
        filters.append(f"[{audio_idx[i]}:a]aresample=44100,aformat=channel_layouts=stereo,apad=whole_dur={s['slot']:.3f},atrim=0:{s['slot']:.3f}[a{i}]")
    filters.append("".join(f"[a{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[voice]")
    mix = ["[voice]"]
    if sfx and n > 1:
        offset = 0.0
        for k in range(1, n):
            offset += scenes[k - 1]["slot"]
            si = add("-i", sfx)
            ms = max(0, int((offset - 0.05) * 1000))
            filters.append(f"[{si}:a]aresample=44100,aformat=channel_layouts=stereo,adelay={ms}|{ms},volume=0.45[sfx{k}]")
            mix.append(f"[sfx{k}]")
    if music:
        fade_out = f"afade=t=out:st={max(0, total - 2):.2f}:d=2"
        if music == "ambient":
            mi = add("-f", "lavfi", "-i", AMBIENT.format(d=f"{total + 1:.2f}"))
            filters.append(f"[{mi}:a]aformat=channel_layouts=stereo,volume=0.07,afade=t=in:d=1.5,{fade_out}[music]")
        else:
            mi = add("-stream_loop", "-1", "-i", music)
            filters.append(f"[{mi}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:{total:.2f},asetpts=N/SR/TB,volume=0.16,afade=t=in:d=1.5,{fade_out}[music]")
        mix.append("[music]")
    filters.append("".join(mix) + f"amix=inputs={len(mix)}:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
    cmd = [ffmpeg, "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats", *inputs,
           "-filter_complex", ";".join(filters), "-map", f"[{video_label}]", "-map", "[aout]",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-t", f"{total:.3f}", str(out_path)]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=NO_WINDOW)
    for line in proc.stdout:
        m = re.match(r"out_time_(?:us|ms)=(\d+)", line)
        if m:
            progress(min(99, int(int(m.group(1)) / 1_000_000 / max(total, 0.1) * 100)), 100)
    err = proc.stderr.read()
    if proc.wait() != 0 or not Path(out_path).exists():
        raise VideoError("Video editing failed: " + err[-400:])
    return total


def plan_captions(scenes, folder):
    """
    scenes: [{"spoken", "slot", "adur"}]  -> reel-style caption chunks (2-3 shabd) ka time-table.
    Har chunk ka time shabdon ki lambai ke hisaab se baanta jata hai (awaaz ke andaaze se).
    """
    caps, start_of_scene, n = [], 0.0, 0
    for sc in scenes:
        chunks, cur = [], []
        for word in sc["spoken"].split():
            if cur and len(" ".join(cur + [word])) > 18:
                chunks.append(" ".join(cur))
                cur = []
            cur.append(word)
            if len(cur) == 3 or len(" ".join(cur)) >= 12:
                chunks.append(" ".join(cur))
                cur = []
        if cur:
            chunks.append(" ".join(cur))
        weights = [max(1, len(c)) for c in chunks]
        whole, acc, begin = sum(weights) or 1, 0, start_of_scene + 0.05
        for k, (chunk, w) in enumerate(zip(chunks, weights)):
            a, b = begin + sc["adur"] * acc / whole, begin + sc["adur"] * (acc + w) / whole
            acc += w
            text = chunk.rstrip(".,;:!?") or chunk
            text = text.upper() if text.isascii() else text
            tf = Path(folder) / f"cap{n}.txt"
            n += 1
            tf.write_text(text, encoding="utf-8")
            caps.append({"start": a, "end": b + (0.2 if k == len(chunks) - 1 else 0), "textfile": tf, "font": find_font(text)})
        start_of_scene += sc["slot"]
    return caps


# ---------- scenes without a browser (Claude / scripts ke liye) ----------

def parse_scenes(script, hook="", cta=""):
    """Script ko scenes me todta hai: [{"spoken": ..., "onscreen": ...}]. (index.html ke parseScenes jaisa)"""
    parts = [p.strip() for p in re.split(r"(?im)^\s*[*#\s]*scene\s*\d+[*\s]*[:.\-\u2013]?", script or "") if p.strip()]
    if len(parts) < 2:  # "Scene N" nahi mila: 2-2 vaakya ka ek scene
        sentences = [x.strip() for x in re.split(r"(?<=[.!?\u0964])\s+", re.sub(r"\[[^\]]*\]", " ", script or "")) if x.strip()]
        parts = [" ".join(sentences[i:i + 2]) for i in range(0, len(sentences), 2)]
    scenes = []
    for part in parts:
        onscreen = [m.strip() for m in re.findall(r"\[(?:on[- ]?screen text|text|caption|visual)?\s*:?\s*([^\]]+)\]", part, re.I) if m.strip()]
        spoken = re.sub(r"\[[^\]]*\]|\([^)]*\)", " ", part)
        spoken = re.sub(r"(?im)^\s*(?:voice[- ]?over|narrator|avatar|speaker|vo)\s*:", "", spoken)
        spoken = re.sub(r"\s+", " ", re.sub(r'[*_#"\u201c\u201d]', "", spoken)).strip()
        if spoken:
            scenes.append({"spoken": spoken, "onscreen": onscreen[0] if onscreen else ""})
    scenes = scenes[:20]
    if cta and scenes and cta.lower().strip(' .!') not in scenes[-1]["spoken"].lower():
        scenes.append({"spoken": cta, "onscreen": ""})  # end me CTA
    if not scenes:
        scenes = [{"spoken": x, "onscreen": ""} for x in (hook, cta) if x]
    return scenes


FONT_CANDIDATES = {
    "Windows": {"latin": ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"],
                "deva": ["C:/Windows/Fonts/NirmalaB.ttf", "C:/Windows/Fonts/Nirmala.ttf"]},
    "Darwin": {"latin": ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc"],
               "deva": ["/System/Library/Fonts/Supplemental/DevanagariMT.ttc", "/System/Library/Fonts/Kohinoor.ttc"]},
    "Linux": {"latin": ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"],
              "deva": ["/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf", "/usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf",
                       "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]},
}


def find_font(text):
    kind = "deva" if re.search(r"[\u0900-\u097F]", text) else "latin"
    for path in FONT_CANDIDATES.get(platform.system(), FONT_CANDIDATES["Linux"])[kind]:
        if Path(path).exists():
            return path
    raise VideoError("No font found on this computer to draw the scene text.")


def _rgb(hex_color):
    n = int(hex_color.lstrip("#"), 16)
    return (n >> 16) & 255, (n >> 8) & 255, n & 255


def _shade(rgb, amt):
    return tuple(max(0, min(255, round(c + amt))) for c in rgb)


def _filter_path(p):
    return str(p).replace("\\", "/").replace(":", "\\:")


def render_card(ffmpeg, out_png, scene, i, n, height, primary, secondary, folder, transparent=False):
    """Ek scene ka card (PNG): gradient (ya transparent, jab photo/clip peeche ho), upar on-screen headline, progress bar.
    Bolne wala text yahan nahi, wo reel-style captions ban kar video par baad me aata hai."""
    h, w = height, height * 9 // 16
    p, s = _rgb(primary), _rgb(secondary)
    pairs = [(p, s), (_shade(p, -50), p), (s, _shade(p, -30)), (_shade(s, -60), _shade(p, 20))]
    c1, c2 = pairs[i % 4]
    head = scene.get("onscreen", "")
    margin = int(w * 0.09)
    box_w = w - 2 * margin
    base = ("color=c=black@0.0:s={w}x{h}:d=1,format=rgba" if transparent else "color=c=black:s={w}x{h}:d=1,format=rgb24").format(w=w, h=h)
    parts = [] if transparent else [
        f"geq=r='{c1[0]}+({c2[0]}-{c1[0]})*(0.35*X/W+0.65*Y/H)':g='{c1[1]}+({c2[1]}-{c1[1]})*(0.35*X/W+0.65*Y/H)':b='{c1[2]}+({c2[2]}-{c1[2]})*(0.35*X/W+0.65*Y/H)'"]
    bar = max(4, int(h * .006))
    parts += [f"drawbox=x={int(w * .08)}:y={int(h * .04)}:w={int(w * .84)}:h={bar}:color=white@0.35:t=fill",
              f"drawbox=x={int(w * .08)}:y={int(h * .04)}:w={int(w * .84 * (i + 1) / n)}:h={bar}:color=white:t=fill"]
    if head:
        font = _filter_path(find_font(head))
        for px in range(int(w * .105), int(w * .045) - 1, -4):
            lines = textwrap.wrap(head.upper() if head.isascii() else head, width=max(8, int(box_w / (px * 0.6))), break_long_words=True)
            if len(lines) * px * 1.25 <= h * 0.3:
                break
        for k, line in enumerate(lines):
            tf = Path(folder) / f"head{i}-{k}.txt"
            tf.write_text(line, encoding="utf-8")
            parts.append(f"drawtext=fontfile='{font}':textfile='{_filter_path(tf)}':fontsize={px}:fontcolor=white:x=(w-text_w)/2:"
                         f"y={int(h * 0.14 + k * px * 1.25)}:borderw={max(2, int(px * 0.05))}:bordercolor=black@0.55")
    r = run([ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-i", base, "-vf", ",".join(parts), "-frames:v", "1", str(out_png)])
    if r.returncode or not Path(out_png).exists():
        raise VideoError("Could not draw a scene card: " + r.stderr[-300:])
