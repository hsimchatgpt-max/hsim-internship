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


def compose(ffmpeg, scenes, out_path, music, height, sfx, progress):
    """
    scenes: [{"image": png-path, "audio": audio-path, "slot": seconds}]
    music: None | "ambient" | path ; height: 1280 (HD) ya 1920 (full HD) ; sfx: bool
    """
    n, T = len(scenes), TRANSITION_SECS
    width = height * 9 // 16
    total = sum(s["slot"] for s in scenes)
    inputs, filters = [], []
    for i, s in enumerate(scenes):
        dur = s["slot"] + (T if i < n - 1 else 0.0)
        inputs += ["-loop", "1", "-framerate", "30", "-t", f"{dur:.3f}", "-i", s["image"]]
        x = f"(in_w-out_w)*t/{dur:.3f}" if i % 2 == 0 else f"(in_w-out_w)*(1-t/{dur:.3f})"  # pan: left->right, phir right->left
        filters.append(
            f"[{i}:v]scale={int(width * 1.06) // 2 * 2}:{int(height * 1.06) // 2 * 2}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height}:x='{x}':y='(in_h-out_h)/2',fps=30,format=yuv420p,setsar=1[v{i}]")
    for i, s in enumerate(scenes):
        inputs += ["-i", s["audio"]]
    # video: xfade chain
    last, offset = "v0", 0.0
    for k in range(1, n):
        offset += scenes[k - 1]["slot"]
        filters.append(f"[{last}][v{k}]xfade=transition={TRANSITIONS[(k - 1) % len(TRANSITIONS)]}:duration={T}:offset={offset:.3f}[x{k}]")
        last = f"x{k}"
    video_label = last
    # voice: har scene ko slot tak pad karke jodo
    for i, s in enumerate(scenes):
        filters.append(f"[{n + i}:a]aresample=44100,aformat=channel_layouts=stereo,apad=whole_dur={s['slot']:.3f},atrim=0:{s['slot']:.3f}[a{i}]")
    filters.append("".join(f"[a{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[voice]")
    mix, next_input = ["[voice]"], 2 * n
    if sfx and n > 1:
        offset = 0.0
        for k in range(1, n):
            offset += scenes[k - 1]["slot"]
            inputs += ["-i", sfx]
            ms = max(0, int((offset - 0.05) * 1000))
            filters.append(f"[{next_input}:a]aresample=44100,aformat=channel_layouts=stereo,adelay={ms}|{ms},volume=0.45[sfx{k}]")
            mix.append(f"[sfx{k}]")
            next_input += 1
    if music:
        if music == "ambient":
            inputs += ["-f", "lavfi", "-i", AMBIENT.format(d=f"{total + 1:.2f}")]
            filters.append(f"[{next_input}:a]aformat=channel_layouts=stereo,volume=0.07,afade=t=in:d=1.5,afade=t=out:st={max(0, total - 2):.2f}:d=2[music]")
        else:
            inputs += ["-stream_loop", "-1", "-i", music]
            filters.append(f"[{next_input}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:{total:.2f},asetpts=N/SR/TB,volume=0.16,"
                           f"afade=t=in:d=1.5,afade=t=out:st={max(0, total - 2):.2f}:d=2[music]")
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
