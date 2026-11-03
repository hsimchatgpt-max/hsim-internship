"""Agent 3 - Video Editor: turns the shot list + voice into a finished vertical video.

Timeline -> beats (cuts) -> one clip per beat -> xfade transitions -> captions burned in
-> music (auto-ducked) + whoosh/pop sound effects -> loudness normalisation -> mp4.
"""
from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np

from ..config import FPS, PLATFORMS
from ..media import audio_synth, captions, ffutil, fonts, visuals
from ..media.broll import IMAGE_EXT
from ..media.tts import Narration

DEFAULT_PARAMS = {"shot_scale": 1.0, "music_mult": 1.0, "cap_words": 3, "cap_scale": 1.0, "duck": 0.78}


def _beats(shots, narr: Narration, pf: dict, params: dict) -> list[dict]:
    lo, hi = pf["shot_sec"]
    target = (lo + hi) / 2 * params["shot_scale"]
    beats = []
    for i, shot in enumerate(shots):
        t0, t1 = narr.windows[i]
        dur = t1 - t0
        n = max(1, round(dur / target), len(shot["clips"]))
        n = min(n, max(1, int(dur / 0.9)))                    # never shorter than 0.9s
        for k in range(n):
            beats.append({"scene": i, "k": k, "n": n, "t0": t0 + dur * k / n, "t1": t0 + dur * (k + 1) / n, "shot": shot})
    return beats


def _cover(w: int, h: int, zoom: float = 1.0) -> str:
    z = f"scale=iw*{zoom}:ih*{zoom}," if zoom != 1.0 else ""
    return f"scale={w}:{h}:force_original_aspect_ratio=increase,{z}crop={w}:{h}"


def _render_beat(b: dict, L: float, idx: int, ctx: dict) -> Path:
    W, H = ctx["size"]
    shot, out = b["shot"], ctx["work"] / f"beat{idx:03d}.mp4"
    enc = ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-r", str(FPS), "-t", f"{L:.3f}"]
    zoom_in = 1.0 if b["k"] % 2 == 0 else 1.14                 # punch-in on every 2nd cut of a scene
    frames = int(L * FPS) + 2

    def kenburns(img: Path, direction: str) -> list[str]:
        z = ("min(zoom+0.0007,1.15)" if direction in ("zoom_in", "pan_left") else "if(eq(on,1),1.15,max(zoom-0.0007,1.0))")
        x = {"pan_left": "x+0.4", "pan_right": "if(eq(on,1),iw*0.08,x-0.4)"}.get(direction, "iw/2-(iw/zoom/2)")
        vf = f"scale={W * 2}:{H * 2},zoompan=z='{z}':x='{x}':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={FPS},format=yuv420p"
        return ["-loop", "1", "-i", str(img), "-vf", vf, *enc]

    visual = shot["visual"]
    if visual == "avatar" and ctx["avatar"] == "face":
        vf = f"{_cover(W, H, zoom_in)},fps={FPS},tpad=stop_mode=clone:stop_duration=15,format=yuv420p"
        args = ["-ss", f"{b['t0']:.3f}", "-i", str(ctx["face_video"]), "-vf", vf, *enc]
    elif visual == "avatar" and ctx["avatar"] == "ai" and ctx["avatar_image"]:
        args = kenburns(Path(ctx["avatar_image"]), "zoom_in" if b["k"] % 2 == 0 else "zoom_out")
    elif visual == "avatar" and ctx["avatar"] == "ai":
        f0, f1 = int(b["t0"] * FPS), int(b["t0"] * FPS) + int(round(L * FPS))
        states = visuals.mouth_states(ctx["narr"].envelope, FPS, f0, f1)
        lst = ctx["work"] / f"avatar{idx:03d}.txt"
        lines, run_state, run_n = [], None, 0
        for st in states + [None]:
            if st == run_state:
                run_n += 1
                continue
            if run_state is not None:
                lines.append(f"file '{ctx['sprites'][run_state]}'\nduration {run_n / FPS:.4f}")
            run_state, run_n = st, 1
        lines.append(f"file '{ctx['sprites'][states[-1]]}'")
        lst.write_text("\n".join(lines))
        theme = (shot["theme"] + b["k"]) % 4
        bg = ctx["work"] / f"bg{theme}.png"
        if not bg.exists():
            visuals.gradient_bg(bg, ctx["size"], theme)
        sz = int(W * (0.98 if b["k"] % 2 == 0 else 1.22))            # punch-in on every 2nd cut
        # sprite bottom always sits at/below the frame edge (shoulders never float); gentle upward bob
        fc = (f"[1:v]fps={FPS},scale={sz}:{sz},format=rgba[a];"
              f"[0:v][a]overlay=x=(W-w)/2:y=H-h+14+14*sin(2*PI*t*1.4):shortest=1,format=yuv420p")
        args = ["-loop", "1", "-i", str(bg), "-f", "concat", "-safe", "0", "-i", str(lst), "-filter_complex", fc, *enc]
    elif visual == "broll" and shot["clips"]:
        clip = Path(shot["clips"][min(b["k"], len(shot["clips"]) - 1)])
        if clip.suffix.lower() in IMAGE_EXT:
            args = kenburns(clip, shot["effect"])
        else:
            clen = ffutil.duration(clip)
            ss = min(max(0.0, clen - L - 0.1), b["k"] * 1.3) if clen > L + 0.2 else 0
            vf = f"{_cover(W, H, zoom_in)},fps={FPS},eq=brightness=-0.05:saturation=1.1,format=yuv420p"
            args = ["-stream_loop", "-1", "-ss", f"{ss:.2f}", "-i", str(clip), "-vf", vf, *enc]
    else:                                                       # text card / no footage
        theme = (shot["theme"] + b["k"]) % 4
        bg = ctx["work"] / f"bg{theme}.png"
        if not bg.exists():
            visuals.gradient_bg(bg, ctx["size"], theme)
        args = kenburns(bg, ["zoom_in", "zoom_out"][b["k"] % 2])
    ffutil.run([*args, str(out)])
    return out


def edit(script: dict, shots: list[dict], narr: Narration, platform: str, work: Path, out_path: Path,
         avatar: str = "none", avatar_image: str | None = None, face_video: str | None = None,
         music_path: str | None = None, params: dict | None = None, log=print) -> dict:
    pf = PLATFORMS[platform]
    params = {**DEFAULT_PARAMS, **(params or {})}
    work.mkdir(parents=True, exist_ok=True)
    W, H = pf["size"]
    ctx = {"size": pf["size"], "work": work, "avatar": avatar, "avatar_image": avatar_image,
           "face_video": face_video, "narr": narr, "sprites": None}
    if avatar == "ai" and not avatar_image:
        ctx["sprites"] = visuals.avatar_sprites(work, seed=sum(map(ord, script["topic"])))

    # 1. cuts ------------------------------------------------------------------------------
    beats = _beats(shots, narr, pf, params)
    trans, durs = [], []
    for j in range(1, len(beats)):
        same_scene = beats[j]["scene"] == beats[j - 1]["scene"]
        if same_scene:
            trans.append("fade"); durs.append(0.06)
        else:
            trans.append(pf["transitions"][(j // 2) % len(pf["transitions"])]); durs.append(0.30)
    log(f"  [edit] {len(beats)} cuts, avg shot {narr.duration / len(beats):.1f}s")

    # 2. clips -----------------------------------------------------------------------------
    clips = []
    for j, b in enumerate(beats):
        beat_len = b["t1"] - b["t0"]
        L = beat_len + (durs[j] if j < len(durs) else 0)
        clips.append(_render_beat(b, L, j, ctx))

    # 3. transitions -----------------------------------------------------------------------
    joined = work / "joined.mp4"
    if len(clips) == 1:
        shutil.copy(clips[0], joined)
    else:
        parts, prev, starts = [], "[0:v]", [b["t0"] for b in beats]
        for j in range(1, len(clips)):
            lab = f"[x{j}]"
            parts.append(f"{prev}[{j}:v]xfade=transition={trans[j - 1]}:duration={durs[j - 1]}:offset={starts[j]:.3f}{lab}")
            prev = lab
        inputs = [a for c in clips for a in ("-i", str(c))]
        ffutil.run([*inputs, "-filter_complex", ";".join(parts), "-map", prev, "-an", "-c:v", "libx264",
                    "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", str(joined)])

    # 4. captions + headline labels ---------------------------------------------------------
    font, fdir = fonts.caption_font(script["language"])
    if fdir:
        shutil.copytree(fdir, work / "fonts", dirs_exist_ok=True)
    ass = work / "captions.ass"
    pops = captions.build_ass(ass, narr.words, narr.windows, script["scenes"], (W, H), platform, font,
                              params["cap_words"], params["cap_scale"])

    # 5. audio: voice + ducked music + sfx -------------------------------------------------
    voice = ffutil.decode_audio(narr.wav)
    user_music = ffutil.decode_audio(music_path) if music_path else None
    whoosh_t = [beats[j]["t0"] for j in range(1, len(beats)) if beats[j]["scene"] != beats[j - 1]["scene"]]
    mix = audio_synth.mix(voice, narr.duration, pf["music_bpm"], platform == "instagram",
                          pf["music_gain"] * params["music_mult"], whoosh_t, pops, user_music,
                          seed=sum(map(ord, script["topic"])), duck_depth=params["duck"])
    mix_wav = work / "mix.wav"
    ffutil.write_wav(mix_wav, mix)

    # 6. final render ----------------------------------------------------------------------
    vf = "subtitles=captions.ass" + (":fontsdir=fonts" if fdir else "")
    ffutil.run(["-i", "joined.mp4", "-i", "mix.wav", "-vf", vf,
                "-af", f"loudnorm=I={pf['target_lufs']}:TP=-1.5:LRA=9",
                "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", str(FPS),
                "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-movflags", "+faststart",
                "-t", f"{narr.duration:.3f}", str(out_path.resolve())], cwd=work)
    return {"video": str(out_path), "cuts": len(beats), "duration": narr.duration, "ass": str(ass),
            "voice_source": narr.source}
