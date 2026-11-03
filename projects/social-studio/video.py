"""Free video engine: voice (TTS) + scene images -> edited MP4 with FFmpeg.

Sirf Python ki built-in libraries use hui hain. Bahar ke tools:
  - FFmpeg (zaroori; Settings se download ho jata hai)
  - edge-tts (optional, behtar voices; `pip install edge-tts`), warna computer ki apni voice
"""
import array
import asyncio
import importlib
import os
import platform
import random
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


def default_voice(language, voices, gender=None):
    """Brand language (aur avatar ke gender) ke hisaab se voice. Hinglish (Roman Hindi) ke liye Indian English voice behtar padhti hai."""
    male = gender == "m"
    if language == "hindi":
        wanted = ["hi-IN-MadhurNeural" if male else "hi-IN-SwaraNeural", "hi"]
    else:
        wanted = ["en-IN-PrabhatNeural" if male else "en-IN-NeerjaNeural", "en"]
    for v in voices:
        if v["id"] == "edge:" + wanted[0]:
            return v["id"]
    for v in voices:
        if v["lang"] == wanted[1]:
            return v["id"]
    return voices[0]["id"] if voices else ""


EMOTIONS = {  # (speed, pitch): awaaz me bhavna
    "excited": ("+10%", "+4Hz"), "urgent": ("+14%", "+2Hz"), "curious": ("+2%", "+3Hz"),
    "serious": ("-6%", "-3Hz"), "calm": ("-8%", "+0Hz"), "warm": ("-2%", "+1Hz"),
}


def synth(text, voice, out_path, ffmpeg, emotion=""):
    """Text ko bolkar audio file (out_path) me save karta hai. emotion se speed/pitch badalti hai (sirf Edge voices me)."""
    out_path = str(out_path)
    if os.environ.get("SOCIAL_STUDIO_MOCK_TTS") == "1":  # sirf testing: nakli awaaz (tone)
        secs = max(1.2, len(text) / 14)
        r = run([ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"sine=f=220:d={secs}", "-af", "tremolo=f=4:d=0.95", out_path])
        if r.returncode:
            raise VideoError(r.stderr[-300:])
        return
    kind, _, name = voice.partition(":")
    try:
        if kind == "edge":
            import edge_tts
            rate, pitch = EMOTIONS.get(emotion.lower().strip(), ("+0%", "+0Hz"))
            asyncio.run(edge_tts.Communicate(text, name, rate=rate, pitch=pitch).save(out_path))
        elif kind == "sys":
            system_speak(text, name, out_path, ffmpeg)
        else:
            raise VideoError("No voice is available. Open Setup and press 'Set up everything'.")
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

def make_sfx(ffmpeg, folder):
    """Chhote sound effects (khud synth): whoosh (transition), pop (headline), impact (shuru), ding (end me CTA)."""
    folder = Path(folder)
    recipes = {
        "whoosh": ["anoisesrc=d=0.7:c=pink:a=0.6", "bandpass=f=1300:width_type=h:w=2200,afade=t=in:d=0.3,afade=t=out:st=0.3:d=0.4,volume=0.8"],
        "pop": ["sine=f=1000:d=0.12", "afade=t=out:st=0.03:d=0.09,volume=0.9"],
        "impact": ["sine=f=55:d=0.8", "afade=t=in:d=0.01,afade=t=out:st=0.08:d=0.7,volume=1.0"],
        "ding": ["aevalsrc='0.5*sin(2*PI*1318*t)+0.3*sin(2*PI*1975*t)':d=0.7:s=44100", "afade=t=out:st=0.05:d=0.65,volume=0.7"],
    }
    out = {}
    for name, (src, af) in recipes.items():
        path = folder / f"sfx_{name}.wav"
        if not path.exists():
            r = run([ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-i", src, "-af", af, str(path)])
            if r.returncode:
                raise VideoError(r.stderr[-300:])
        out[name] = str(path)
    return out


AMBIENT = ("aevalsrc='0.5*sin(2*PI*196*t)+0.4*sin(2*PI*246.9*t)+0.35*sin(2*PI*293.7*t)+0.25*sin(2*PI*392*t)':d={d}:s=44100,"
           "tremolo=f=0.2:d=0.5,lowpass=f=1200")


def motion_filter(i, d, width, height):
    """Har scene ko halki camera-chaal: zoom-in, zoom-out ya pan, baari-baari se (dekhne walo ka dhyaan bana rehta hai)."""
    cover = f"scale={int(width * 1.06) // 2 * 2}:{int(height * 1.06) // 2 * 2}:force_original_aspect_ratio=increase"
    if i % 3 == 0:
        return f"{cover},scale=w='trunc(iw*(1+0.06*t/{d})/2)*2':h=-2:eval=frame,crop={width}:{height}"
    if i % 3 == 1:
        return f"{cover},scale=w='trunc(iw*(1.06-0.06*t/{d})/2)*2':h=-2:eval=frame,crop={width}:{height}"
    return f"{cover},crop={width}:{height}:x='(in_w-out_w)*t/{d}':y='(in_h-out_h)/2'"


GRADE = "eq=contrast=1.06:saturation=1.12:gamma=0.98,vignette=angle=PI/7"  # ek jaisa "cinematic" rang


def compose(ffmpeg, scenes, out_path, music, height, sfx, progress, captions=None, avatar=None):
    """
    scenes: [{"audio", "slot", and either "image" (opaque card)  or  "bg" + "bg_kind" ("image"|"video") + "overlay" (transparent card)}]
    captions: [{"start", "end", "textfile", "font", "color"}]  reel-style captions (2-3 shabd; zaroori shabd peele)
    avatar: path of an ffconcat list of avatar frames (muh awaaz ke saath hilta hai) ya None
    music: None | "ambient" | path ; height: 1280 (HD) ya 1920 (full HD)
    sfx: {"whoosh", "pop", "impact", "ding"} (make_sfx) ya None
    """
    n, T = len(scenes), TRANSITION_SECS
    width = height * 9 // 16
    total = sum(s["slot"] for s in scenes)
    inputs, filters, count = [], [], [0]

    def add(*args):  # input jodta hai, uska index lautata hai
        inputs.extend(args)
        count[0] += 1
        return count[0] - 1

    for i, s in enumerate(scenes):
        dur = s["slot"] + (T if i < n - 1 else 0.0)
        d = f"{dur:.3f}"
        if s.get("bg") and s.get("bg_kind") == "video":  # B-roll / aapki clip
            b = add("-stream_loop", "-1", "-t", d, "-i", s["bg"])
            filters.append(f"[{b}:v]setpts=PTS-STARTPTS,scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},"
                           f"fps=30,eq=brightness=-0.2,format=yuv420p,setsar=1[b{i}]")
        elif s.get("bg"):  # aapki photo
            b = add("-loop", "1", "-framerate", "30", "-t", d, "-i", s["bg"])
            filters.append(f"[{b}:v]{motion_filter(i, d, width, height)},fps=30,eq=brightness=-0.2,format=yuv420p,setsar=1[b{i}]")
        else:
            b = add("-loop", "1", "-framerate", "30", "-t", d, "-i", s["image"])
            filters.append(f"[{b}:v]{motion_filter(i, d, width, height)},fps=30,format=yuv420p,setsar=1[v{i}]")
        if s.get("bg"):
            o = add("-loop", "1", "-framerate", "30", "-t", d, "-i", s["overlay"])
            filters.append(f"[{o}:v]fps=30,format=rgba[o{i}]")
            filters.append(f"[b{i}][o{i}]overlay=0:0:shortest=1,format=yuv420p,setsar=1[v{i}]")
    audio_idx = [add("-i", s["audio"]) for s in scenes]
    # video: xfade chain
    last, offset = "v0", 0.0
    starts = [0.0]
    for k in range(1, n):
        offset += scenes[k - 1]["slot"]
        starts.append(offset)
        filters.append(f"[{last}][v{k}]xfade=transition={TRANSITIONS[(k - 1) % len(TRANSITIONS)]}:duration={T}:offset={offset:.3f}[x{k}]")
        last = f"x{k}"
    filters.append(f"[{last}]{GRADE}[vgr]")
    last = "vgr"
    if avatar:  # avatar neeche, halka sa upar-neeche hilta hua
        ai = add("-f", "concat", "-safe", "0", "-i", avatar)
        aw = int(width * 0.66) // 2 * 2
        filters.append(f"[{ai}:v]fps=30,format=rgba,scale={aw}:-1[av]")
        filters.append(f"[{last}][av]overlay=x=(W-w)/2:y='H-h+{max(3, int(height * 0.004))}*sin(2*PI*t*1.3)':format=auto,format=yuv420p[vav]")
        last = "vav"
    if captions:  # reel-style captions: pile/safed akshar, kaala border, awaaz ke saath badalte hue
        fs = int(width * 0.078)
        chain = [f"drawtext=fontfile='{_filter_path(c['font'])}':textfile='{_filter_path(c['textfile'])}':fontsize={fs}:fontcolor={c.get('color', '0xFFD400')}:"
                 f"borderw={max(3, int(fs * 0.09))}:bordercolor=black:x=(w-text_w)/2:y=h*{0.52 if avatar else 0.64}:enable='between(t,{c['start']:.2f},{c['end']:.2f})'"
                 for c in captions]
        filters.append(f"[{last}]" + ",".join(chain) + "[vcap]")
        last = "vcap"
    video_label = last
    # voice: har scene ko slot tak pad karke jodo
    for i, s in enumerate(scenes):
        filters.append(f"[{audio_idx[i]}:a]aresample=44100,aformat=channel_layouts=stereo,apad=whole_dur={s['slot']:.3f},atrim=0:{s['slot']:.3f}[a{i}]")
    filters.append("".join(f"[a{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[voice]")
    mix = []
    if music:  # music awaaz ke neeche dheema ho jata hai (ducking), taaki dialogue hamesha saaf rahe
        filters.append("[voice]asplit=2[voice1][voice2]")
        mix.append("[voice1]")
    else:
        mix.append("[voice]")
    if sfx:
        events = [(0.05, "impact", 0.5)]
        events += [(starts[k] + 0.1, "pop", 0.3) for k in range(n)]
        events += [(starts[k] - 0.02, "whoosh", 0.4) for k in range(1, n)]
        if n > 2:
            events.append((starts[-1] + 0.25, "ding", 0.35))
        for k, (at, kind, vol) in enumerate(events):
            si = add("-i", sfx[kind])
            ms = max(0, int(at * 1000))
            filters.append(f"[{si}:a]aresample=44100,aformat=channel_layouts=stereo,adelay={ms}|{ms},volume={vol}[sfx{k}]")
            mix.append(f"[sfx{k}]")
    if music:
        fade_out = f"afade=t=out:st={max(0, total - 2):.2f}:d=2"
        if music == "ambient":
            mi = add("-f", "lavfi", "-i", AMBIENT.format(d=f"{total + 1:.2f}"))
            filters.append(f"[{mi}:a]aformat=channel_layouts=stereo,volume=0.12,afade=t=in:d=1.5,{fade_out}[mraw]")
        else:
            mi = add("-stream_loop", "-1", "-i", music)
            filters.append(f"[{mi}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:{total:.2f},asetpts=N/SR/TB,volume=0.3,afade=t=in:d=1.5,{fade_out}[mraw]")
        filters.append("[mraw][voice2]sidechaincompress=threshold=0.03:ratio=10:attack=15:release=350[music]")
        mix.append("[music]")
    filters.append("".join(mix) + f"amix=inputs={len(mix)}:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
    cmd = [ffmpeg, "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats", *inputs,
           "-filter_complex", ";".join(filters), "-map", f"[{video_label}]", "-map", "[aout]",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", f"{total:.3f}", str(out_path)]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=NO_WINDOW)
    for line in proc.stdout:
        m = re.match(r"out_time_(?:us|ms)=(\d+)", line)
        if m:
            progress(min(99, int(int(m.group(1)) / 1_000_000 / max(total, 0.1) * 100)), 100)
    err = proc.stderr.read()
    if proc.wait() != 0 or not Path(out_path).exists():
        raise VideoError("Video editing failed: " + err[-400:])
    return total


AV_STEP = 0.08  # muh ki chaal har 0.08 second me badalti hai


def audio_rms(ffmpeg, audio):
    """Awaaz ki taakat (loudness) har AV_STEP second ke liye."""
    r = subprocess.run([ffmpeg, "-v", "error", "-i", str(audio), "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
                       capture_output=True, creationflags=NO_WINDOW)
    samples = array.array("h")
    samples.frombytes(r.stdout[: len(r.stdout) // 2 * 2])
    n = int(8000 * AV_STEP)
    return [(sum(x * x for x in samples[i:i + n]) / max(1, len(samples[i:i + n]))) ** 0.5 for i in range(0, len(samples), n)]


def build_avatar_list(avatar_dir, scenes, out_list, seed=7):
    """
    scenes: [{"rms": [...], "slot": seconds}]  ->  ffconcat file: kaun sa avatar frame kab dikhana hai.
    Muh ke 4 levels (band, thoda, aadha, poora khula) awaaz ki taakat se; palkein har 3-5 second me.
    Frame ke naam: m<muh 0-3>e<aankh 0 khuli / 1 band>.png
    """
    ranked = sorted(x for sc in scenes for x in sc["rms"])
    peak = max(ranked[max(0, int(len(ranked) * 0.95) - 1)] if ranked else 1, 1)  # sabse zor ki awaaz ke aas-paas
    mouth = []
    for sc in scenes:
        steps = max(1, round(sc["slot"] / AV_STEP))
        rms = sc["rms"][:steps] + [0] * max(0, steps - len(sc["rms"]))  # bolne ke baad ki khamoshi me muh band
        for x in rms:
            r = x / peak
            mouth.append(0 if r < 0.1 else 1 if r < 0.3 else 2 if r < 0.6 else 3)
    eyes = [0] * len(mouth)
    rng, i = random.Random(seed), 0
    i = int(rng.uniform(25, 50))
    while i < len(eyes) - 2:  # palak: 2 step (0.16 s)
        eyes[i] = eyes[i + 1] = 1
        i += int(rng.uniform(40, 62))
    merged = []
    for m, e in zip(mouth, eyes):
        name = f"m{m}e{e}"
        if merged and merged[-1][0] == name:
            merged[-1][1] += AV_STEP
        else:
            merged.append([name, AV_STEP])
    base = str(Path(avatar_dir).resolve()).replace("\\", "/").replace("'", "'\\''")
    lines = []
    for name, d in merged:
        lines += [f"file '{base}/{name}.png'", f"duration {d:.3f}"]
    lines.append(f"file '{base}/{merged[-1][0]}.png'")  # ffconcat: aakhri frame dobara likhna padta hai
    Path(out_list).write_text("\n".join(lines), encoding="utf-8")


def plan_captions(scenes, folder):
    """
    scenes: [{"spoken", "slot", "adur", "keywords": set}]  -> reel-style caption chunks (2-3 shabd) ka time-table.
    Har chunk ka time shabdon ki lambai ke hisaab se baanta jata hai (awaaz ke andaaze se).
    Zaroori shabdon (on-screen text ke shabd, ankdey) wale chunk peele, baaki safed.
    """
    caps, start_of_scene, n = [], 0.0, 0
    for sc in scenes:
        keys = {k.lower() for k in sc.get("keywords", ())}
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
            important = any(re.sub(r"\W", "", x).lower() in keys or any(ch.isdigit() for ch in x) for x in text.split())
            text = text.upper() if text.isascii() else text
            tf = Path(folder) / f"cap{n}.txt"
            n += 1
            tf.write_text(text, encoding="utf-8")
            caps.append({"start": a, "end": b + (0.2 if k == len(chunks) - 1 else 0), "textfile": tf, "font": find_font(text),
                         "color": "0xFFD400" if important else "white"})
        start_of_scene += sc["slot"]
    return caps


TAG_RE = re.compile(r"\[\s*([A-Za-z][A-Za-z\- ]*?)\s*:\s*([^\]]*)\]")


def parse_scenes(script, hook="", cta=""):
    """
    Script ko scenes me todta hai: [{"spoken", "onscreen", "broll", "emotion"}].
    Script ka format:  Scene N: <bolne wali line> [on-screen text: ..] [broll: ..] [emotion: excited]
    """
    parts = [p.strip() for p in re.split(r"(?im)^\s*[*#\s]*scene\s*\d+[*\s]*[:.\-\u2013]?", script or "") if p.strip()]
    if len(parts) < 2:  # "Scene N" nahi mila: 2-2 vaakya ka ek scene
        sentences = [x.strip() for x in re.split(r"(?<=[.!?\u0964])\s+", re.sub(r"\[[^\]]*\]", " ", script or "")) if x.strip()]
        parts = [" ".join(sentences[i:i + 2]) for i in range(0, len(sentences), 2)]
    scenes = []
    for part in parts:
        tags = {re.sub(r"[\s\-]", "", k).lower(): val.strip() for k, val in TAG_RE.findall(part)}
        bare = [x.strip() for x in re.findall(r"\[([^\]:]+)\]", part) if x.strip()]  # [sirf text] bhi chalega
        spoken = re.sub(r"\[[^\]]*\]|\([^)]*\)", " ", part)
        spoken = re.sub(r"(?im)^\s*(?:voice[- ]?over|narrator|avatar|speaker|vo)\s*:", "", spoken)
        spoken = re.sub(r"\s+", " ", re.sub(r'[*_#"\u201c\u201d]', "", spoken)).strip()
        if spoken:
            scenes.append({"spoken": spoken,
                           "onscreen": tags.get("onscreentext") or tags.get("text") or tags.get("caption") or (bare[0] if bare else ""),
                           "broll": tags.get("broll") or tags.get("footage") or tags.get("visual") or "",
                           "emotion": tags.get("emotion") or tags.get("tone") or ""})
    scenes = scenes[:20]
    if cta and scenes and cta.lower().strip(" .!") not in scenes[-1]["spoken"].lower():
        scenes.append({"spoken": cta, "onscreen": "", "broll": "", "emotion": "warm"})  # end me CTA
    if not scenes:
        scenes = [{"spoken": x, "onscreen": "", "broll": "", "emotion": ""} for x in (hook, cta) if x]
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
