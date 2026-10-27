"""Social Studio: content creator (quick create, step-by-step or automatic) + optional monthly calendar.

Sirf Python ki built-in libraries use hui hain, to koi `pip install` nahi chahiye.
Chalane ke liye:  python server.py   (phir browser me http://localhost:8000)
"""
import base64
import calendar
import json
import os
import platform
import re
import shutil
import sqlite3
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
import uuid
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import video as vid

BASE = Path(__file__).parent
DATA = BASE / "data"
STATIC = BASE / "static"
DB_PATH = DATA / "studio.db"
SETTINGS_PATH = DATA / "settings.json"
PORT = int(os.environ.get("PORT", "8000"))

FORMATS = ["image", "video", "carousel", "text", "story"]
CONTENT_TYPES = [
    "educational", "motivational", "promotional", "meme", "tips",
    "behind-the-scenes", "testimonial", "news", "story", "question",
]
PLATFORMS = ["youtube", "linkedin", "instagram", "facebook", "x"]
STATUSES = ["idea", "draft", "ready", "scheduled", "posted"]
DURATIONS = ["15-30 sec", "30-60 sec", "60-90 sec"]
MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"]  # sirf tab jab model list na mile
STEPS = ["all", "script", "caption", "edit", "image"]

DB_LOCK = threading.Lock()


# ---------- storage ----------

def db():
    DATA.mkdir(exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


NEW_COLUMNS = [  # purane data wale users ke liye migration
    ("edit_plan", "TEXT NOT NULL DEFAULT ''"),
    ("duration", "TEXT NOT NULL DEFAULT '30-60 sec'"),
    ("gen_status", "TEXT NOT NULL DEFAULT ''"),
    ("gen_error", "TEXT NOT NULL DEFAULT ''"),
    ("design", "TEXT NOT NULL DEFAULT ''"),  # manual image designer ki settings (JSON)
    ("images", "TEXT NOT NULL DEFAULT '[]'"),  # AI se bani image files ke naam (JSON list)
    ("video", "TEXT NOT NULL DEFAULT ''"),  # bani hui video file ka naam
]


def init_db():
    with DB_LOCK, db() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS brand (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                format TEXT NOT NULL DEFAULT 'image',
                content_type TEXT NOT NULL DEFAULT 'educational',
                topic TEXT NOT NULL DEFAULT '',
                platforms TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'idea',
                time TEXT NOT NULL DEFAULT '10:00',
                hook TEXT NOT NULL DEFAULT '',
                caption TEXT NOT NULL DEFAULT '',
                hashtags TEXT NOT NULL DEFAULT '',
                cta TEXT NOT NULL DEFAULT '',
                script TEXT NOT NULL DEFAULT '',
                image_idea TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_posts_date ON posts(date);
            """
        )
        have = {r["name"] for r in con.execute("PRAGMA table_info(posts)")}
        for name, ddl in NEW_COLUMNS:
            if name not in have:
                con.execute(f"ALTER TABLE posts ADD COLUMN {name} {ddl}")
        # server band hone par adhoora reh gaya kaam
        con.execute(
            "UPDATE posts SET gen_status = 'error', gen_error = 'Interrupted. Please generate again.' "
            "WHERE gen_status IN ('queued', 'running')"
        )


FONTS = ["sans", "serif", "display"]
DEFAULT_BRAND = {
    "name": "", "business": "", "audience": "", "tone": "friendly",
    "language": "hinglish", "platforms": ["instagram", "linkedin", "youtube"],
    "primary": "#5b4bdb", "secondary": "#ff7a59", "text_color": "#ffffff", "font": "sans", "logo": "",
}
COLOR_RE = re.compile(r"#[0-9a-fA-F]{6}")


def get_brand():
    with DB_LOCK, db() as con:
        row = con.execute("SELECT data FROM brand WHERE id = 1").fetchone()
    return {**DEFAULT_BRAND, **(json.loads(row["data"]) if row else {})}


def save_brand(data):
    clean = {k: data.get(k, DEFAULT_BRAND[k]) for k in DEFAULT_BRAND}
    for key in ("primary", "secondary", "text_color"):
        if not COLOR_RE.fullmatch(str(clean[key])):
            clean[key] = DEFAULT_BRAND[key]
    if clean["font"] not in FONTS:
        clean["font"] = "sans"
    logo = str(clean["logo"])
    clean["logo"] = logo if logo.startswith("data:image/") and len(logo) < 400_000 else ""
    with DB_LOCK, db() as con:
        con.execute("INSERT OR REPLACE INTO brand (id, data) VALUES (1, ?)", (json.dumps(clean),))
    return clean


def row_to_post(row):
    post = dict(row)
    post["platforms"] = json.loads(post["platforms"] or "[]")
    post["images"] = json.loads(post.get("images") or "[]")
    return post


POST_FIELDS = [
    "date", "format", "content_type", "topic", "platforms", "status", "time", "duration",
    "hook", "caption", "hashtags", "cta", "script", "image_idea", "edit_plan", "design",
]


def clean_post_fields(data, partial):
    out = {}
    for key in POST_FIELDS:
        if key not in data:
            continue
        val = data[key]
        if key == "platforms":
            val = json.dumps([p for p in val if p in PLATFORMS]) if isinstance(val, list) else "[]"
        elif key == "format" and val not in FORMATS:
            val = "image"
        elif key == "content_type" and val not in CONTENT_TYPES:
            val = "educational"
        elif key == "status" and val not in STATUSES:
            val = "idea"
        elif key == "duration" and val not in DURATIONS:
            val = "30-60 sec"
        elif key == "date":
            date.fromisoformat(str(val))  # galat date par ValueError -> 400
        elif key == "design":
            val = str(val)[:4000]
        elif key == "time":
            if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(val)):
                val = "10:00"
        else:
            val = str(val)
        out[key] = val
    if not partial and "date" not in out:
        raise ValueError("date is required")
    return out


def create_post(data):
    fields = clean_post_fields(data, partial=False)
    cols = ", ".join(fields)
    marks = ", ".join("?" for _ in fields)
    with DB_LOCK, db() as con:
        cur = con.execute(f"INSERT INTO posts ({cols}) VALUES ({marks})", list(fields.values()))
        row = con.execute("SELECT * FROM posts WHERE id = ?", (cur.lastrowid,)).fetchone()
    return row_to_post(row)


def update_post(post_id, data):
    fields = clean_post_fields(data, partial=True)
    with DB_LOCK, db() as con:
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            con.execute(f"UPDATE posts SET {sets} WHERE id = ?", [*fields.values(), post_id])
        row = con.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
    return row_to_post(row) if row else None


def set_gen(post_id, status, error=""):
    with DB_LOCK, db() as con:
        con.execute("UPDATE posts SET gen_status = ?, gen_error = ? WHERE id = ?", (status, error[:300], post_id))


def get_post(post_id):
    with DB_LOCK, db() as con:
        row = con.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
    return row_to_post(row) if row else None


def delete_post(post_id):
    with DB_LOCK, db() as con:
        con.execute("DELETE FROM posts WHERE id = ?", (post_id,))


def list_posts(month):
    with DB_LOCK, db() as con:
        rows = con.execute(
            "SELECT * FROM posts WHERE date LIKE ? ORDER BY date, time, id", (month + "-%",)
        ).fetchall()
    return [row_to_post(r) for r in rows]


def export_text(post):
    """Download ke liye 'content pack' (text file)."""
    parts = [
        f"# {post['topic'] or 'Content pack'}",
        f"Date: {post['date']} {post['time']}  |  Format: {post['format']}  |  Type: {post['content_type']}",
        f"Platforms: {', '.join(post['platforms']) or '-'}",
        "", "## Hook", post["hook"], "", "## Caption", post["caption"], "", "## Hashtags", post["hashtags"],
        "", "## Call to action", post["cta"], "", "## Script / on-screen text", post["script"],
        "", "## Editing plan", post["edit_plan"], "", "## Image / visual idea", post["image_idea"], "",
    ]
    return "\n".join(parts)


# ---------- settings / API key ----------

def load_settings():
    try:
        return json.loads(SETTINGS_PATH.read_text())
    except (OSError, ValueError):
        return {}


def save_settings(updates):
    DATA.mkdir(exist_ok=True)
    settings = {**load_settings(), **updates}
    SETTINGS_PATH.write_text(json.dumps(settings))
    try:
        os.chmod(SETTINGS_PATH, 0o600)
    except OSError:
        pass


def get_api_key():
    key = load_settings().get("gemini_api_key") or os.environ.get("GEMINI_API_KEY", "")
    if not key:
        env_file = BASE / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                if line.startswith("GEMINI_API_KEY="):
                    key = line.split("=", 1)[1].strip()
    return key.strip()


# ---------- Gemini ----------

class AIError(Exception):
    pass


API_ROOT = os.environ.get("GEMINI_API_ROOT", "https://generativelanguage.googleapis.com/v1beta")  # env sirf testing ke liye
SKIP_WORDS = ("image", "tts", "audio", "live", "embedding", "vision", "robotics", "computer-use", "learnlm", "gemma", "aqa")
RETRY_CODES = (429, 500, 502, 503, 504)
RETRY_WAITS = [float(w) for w in os.environ.get("RETRY_WAITS", "4,12,25").split(",")]  # busy server par itna ruk kar dobara try
KEY_ERROR = "The API key is invalid or not working. Check it again in Settings."
BUSY_ERROR = "Google's AI is busy right now. Please try again in a minute."
LIMIT_ERROR = "Free limit reached. Please try again in a while (or tomorrow)."
_model_cache = []
_image_model_cache = []


def http_error_message(e):
    """Google ke error body se asli message nikalta hai."""
    try:
        return json.loads(e.read())["error"]["message"]
    except Exception:
        return ""


def model_rank(name):
    """Chhota number = behtar. Stable flash models sabse pehle, phir lite, phir baaki."""
    version = re.search(r"gemini-(\d+(?:\.\d+)?)", name)
    ver = float(version.group(1)) if version else 0
    unstable = any(w in name for w in ("preview", "exp", "latest-"))
    return (0 if "flash" in name else 1, 1 if "lite" in name else 0, 1 if unstable else 0, -ver)


def fetch_model_names(key):
    """Google se poochta hai ki is key par kaun se generateContent models hain."""
    req = urllib.request.Request(API_ROOT + "/models?pageSize=200", headers={"x-goog-api-key": key})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            models = json.loads(resp.read()).get("models", [])
    except urllib.error.HTTPError as e:
        if e.code in (400, 401, 403):
            raise AIError(KEY_ERROR)
        return []
    except (urllib.error.URLError, TimeoutError):
        raise AIError("Could not connect to Gemini. Check your internet connection.")
    return [m["name"].split("/", 1)[-1] for m in models
            if "generateContent" in m.get("supportedGenerationMethods", [])
            and m["name"].split("/", 1)[-1].startswith("gemini")]


def available_models(key, refresh=False):
    """Text models (tez/stable pehle), cache ke saath."""
    if _model_cache and not refresh:
        return list(_model_cache)
    names = [n for n in fetch_model_names(key) if not any(w in n for w in SKIP_WORDS)]
    names.sort(key=model_rank)
    _model_cache[:] = names[:5] or list(MODELS)  # list na mile to purane naam try karo
    return list(_model_cache)


def available_image_models(key, refresh=False):
    """Image bana sakne wale models (naya/stable pehle)."""
    if _image_model_cache and not refresh:
        return list(_image_model_cache)
    names = [n for n in fetch_model_names(key) if "image" in n and not any(w in n for w in ("tts", "audio", "live", "embedding"))]
    names.sort(key=lambda n: (1 if any(w in n for w in ("preview", "exp")) else 0, -float((re.search(r"gemini-(\d+(?:\.\d+)?)", n) or [0, 0])[1] or 0)))
    _image_model_cache[:] = names[:3]
    return list(_image_model_cache)


def request_model(key, model, prompt, think_off):
    config = {"responseMimeType": "application/json", "temperature": 0.9}
    if think_off:
        config["thinkingConfig"] = {"thinkingBudget": 0}  # "sochne" ka time hata kar jawab tez
    body = json.dumps({"contents": [{"parts": [{"text": prompt}]}], "generationConfig": config}).encode()
    req = urllib.request.Request(
        f"{API_ROOT}/models/{model}:generateContent", data=body, method="POST",
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read())
    return json.loads(payload["candidates"][0]["content"]["parts"][0]["text"])


def call_gemini(prompt):
    """Prompt bhejta hai, JSON (dict/list) wapas deta hai. Busy hone par khud retry karta hai."""
    if os.environ.get("SOCIAL_STUDIO_MOCK") == "1":
        return mock_ai(prompt)
    key = get_api_key()
    if not key:
        raise AIError("No Gemini API key found. Add your key on the Settings page.")
    last_error = BUSY_ERROR
    for attempt in range(len(RETRY_WAITS) + 1):
        retryable, all_missing = False, True
        for model in available_models(key, refresh=attempt == len(RETRY_WAITS)):
            for think_off in (True, False):
                try:
                    return request_model(key, model, prompt, think_off)
                except urllib.error.HTTPError as e:
                    msg = http_error_message(e)
                    if e.code in (401, 403) or (e.code == 400 and "API key" in msg):
                        raise AIError(KEY_ERROR)
                    if e.code == 400 and think_off and "think" in msg.lower():
                        continue  # ye model thinking-off nahi samajhta, bina uske try karo
                    if e.code == 404:
                        break  # ye model nahi mila, agla model
                    all_missing = False
                    if e.code in RETRY_CODES:
                        retryable = True
                        last_error = (LIMIT_ERROR + f" [{model}: {msg[:160]}]") if e.code == 429 else BUSY_ERROR
                        break
                    raise AIError(f"Gemini error {e.code}: {msg[:200]}")
                except (urllib.error.URLError, TimeoutError):
                    raise AIError("Could not connect to Gemini. Check your internet connection.")
                except (KeyError, IndexError, ValueError):
                    all_missing = False
                    last_error = "Could not understand the AI response. Please try again."
                    break
        if all_missing:
            last_error = "No Gemini model is available for this key."
        if retryable and attempt < len(RETRY_WAITS):
            time.sleep(RETRY_WAITS[attempt])
            continue
        break
    raise AIError(last_error)


IMAGES_DIR = DATA / "images"
VIDEOS_DIR = DATA / "videos"
MUSIC_DIR = DATA / "music"
MUSIC_EXT = (".mp3", ".wav", ".m4a", ".ogg")
IMAGE_LIMIT_ERROR = ("Image generation limit reached. Image models usually need billing enabled on your Gemini API key "
                     "(Google AI Studio, your key, Set up billing).")
NO_IMAGE_MODEL = "No image model is available for this key. Image generation usually needs billing enabled on the key."


def mock_png():
    """Test ke liye chhoti nakli PNG."""
    import struct
    import zlib
    w = h = 64
    rows = b""
    for y in range(h):
        rows += b"\x00" + b"".join(bytes([x * 4, y * 4, 160]) for x in range(w))

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def request_image(key, model, prompt, aspect, use_ratio):
    config = {"responseModalities": ["TEXT", "IMAGE"]}
    if use_ratio:
        config["imageConfig"] = {"aspectRatio": aspect}
    body = json.dumps({"contents": [{"parts": [{"text": prompt}]}], "generationConfig": config}).encode()
    req = urllib.request.Request(
        f"{API_ROOT}/models/{model}:generateContent", data=body, method="POST",
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        payload = json.loads(resp.read())
    for part in payload["candidates"][0]["content"]["parts"]:
        inline = part.get("inlineData") or part.get("inline_data")
        if inline and inline.get("data"):
            return base64.b64decode(inline["data"])
    raise ValueError("no image in response")


def generate_image(prompt, aspect):
    """Prompt se image (PNG bytes) banwata hai. Busy hone par retry, models par fallback."""
    if os.environ.get("SOCIAL_STUDIO_MOCK") == "1":
        time.sleep(float(os.environ.get("MOCK_DELAY", "0")))
        return mock_png()
    key = get_api_key()
    if not key:
        raise AIError("No Gemini API key found. Add your key on the Settings page.")
    last_error = BUSY_ERROR
    for attempt in range(len(RETRY_WAITS) + 1):
        models = available_image_models(key, refresh=attempt == len(RETRY_WAITS))
        if not models:
            raise AIError(NO_IMAGE_MODEL)
        retryable = False
        for model in models:
            for use_ratio in (True, False):
                try:
                    return request_image(key, model, prompt, aspect, use_ratio)
                except urllib.error.HTTPError as e:
                    msg = http_error_message(e)
                    if e.code in (401, 403) or (e.code == 400 and "API key" in msg):
                        raise AIError(KEY_ERROR)
                    if e.code == 400 and use_ratio:
                        continue  # aspect ratio samajh nahi aaya, bina uske try karo
                    if e.code == 404:
                        break
                    if e.code == 429 and ("limit: 0" in msg or "billing" in msg.lower()):
                        last_error = IMAGE_LIMIT_ERROR + f" [{model}]"
                        break  # is model ki free limit 0 hai, agla model
                    if e.code in RETRY_CODES:
                        retryable = True
                        last_error = (LIMIT_ERROR if e.code == 429 else BUSY_ERROR)
                        break
                    raise AIError(f"Gemini error {e.code}: {msg[:200]}")
                except (urllib.error.URLError, TimeoutError):
                    raise AIError("Could not connect to Gemini. Check your internet connection.")
                except (KeyError, IndexError, ValueError):
                    last_error = "The AI did not return an image. Please try again."
                    break
        if retryable and attempt < len(RETRY_WAITS):
            time.sleep(RETRY_WAITS[attempt])
            continue
        break
    raise AIError(last_error)


def mock_ai(prompt):
    """Test ke liye: asli AI ke bina nakli jawab."""
    time.sleep(float(os.environ.get("MOCK_DELAY", "0")))
    plan = {"topic": "Mock topic"}
    script = {"hook": "Mock hook", "script": "Scene 1: Stop losing customers. [on-screen text: 3 website mistakes] Most business websites lose visitors every day.\n"
                                              "Scene 2: Mistake one is no mobile version. Most people browse on their phones.\n"
                                              "Scene 3: Fix these today and watch your enquiries grow. Follow us for more."}
    caption = {"caption": "Mock caption", "hashtags": ["#mock", "#test"], "cta": "Follow us!"}
    edit = {"edit_plan": {"duration_seconds": 45, "aspect_ratio": "9:16", "broll": ["city", "laptop"],
                          "music_mood": "upbeat", "sound_effects": ["whoosh"], "transitions": "quick cuts",
                          "caption_style": "word highlight", "voice_notes": "warm"}, "image_idea": "Mock image idea"}
    if "PLAN_REQUEST" in prompt:
        return [
            {"day": 1, "format": "video", "content_type": "educational", "topic": "Mock topic 1"},
            {"day": 3, "format": "image", "content_type": "tips", "topic": "Mock topic 2"},
            {"day": 5, "format": "carousel", "content_type": "motivational", "topic": "Mock topic 3"},
        ]
    if "SCRIPT_REQUEST" in prompt:
        return {**plan, **script}
    if "CAPTION_REQUEST" in prompt:
        return caption
    if "EDIT_REQUEST" in prompt:
        return edit
    return {**plan, **script, **caption, **edit}


LANG_NAMES = {"hindi": "Hindi (Devanagari)", "english": "English", "hinglish": "Hinglish (Hindi in Roman script)"}


def brand_context(brand):
    lang = LANG_NAMES.get(brand["language"], brand["language"])
    return (
        f"Brand: {brand['name'] or 'N/A'}\nBusiness: {brand['business'] or 'N/A'}\n"
        f"Target audience: {brand['audience'] or 'N/A'}\nTone: {brand['tone']}\nLanguage: {lang}"
    )


def ai_plan_month(month, theme, posts_per_week):
    brand = get_brand()
    year, mon = map(int, month.split("-"))
    days = calendar.monthrange(year, mon)[1]
    prompt = f"""PLAN_REQUEST
You are a social media strategist. Plan a content calendar.
{brand_context(brand)}
Month: {month} ({days} days). Theme for this month: {theme or 'general'}.
Posts per week: {posts_per_week}. Mix formats ({', '.join(FORMATS)}) and content types ({', '.join(CONTENT_TYPES)}) for variety.
Return ONLY a JSON array. Each item: {{"day": <1-{days}>, "format": <one of formats>, "content_type": <one of content types>, "topic": <short specific topic idea in the brand language>}}.
Spread days evenly across the whole month. No duplicate days."""
    items = call_gemini(prompt)
    if not isinstance(items, list):
        raise AIError("The AI response had the wrong format. Please try again.")
    created, seen = [], set()
    platforms = [p for p in brand["platforms"] if p in PLATFORMS]
    for item in items:
        try:
            day = int(item["day"])
        except (KeyError, TypeError, ValueError):
            continue
        if not 1 <= day <= days or day in seen:
            continue
        seen.add(day)
        created.append(create_post({
            "date": f"{month}-{day:02d}",
            "format": item.get("format", "image"),
            "content_type": item.get("content_type", "educational"),
            "topic": str(item.get("topic", ""))[:300],
            "platforms": platforms,
            "status": "idea",
        }))
    return created


SCRIPT_RULES = {
    "video": "a spoken script for a talking-avatar video, scene by scene (Scene 1, Scene 2...), spoken lines plus short [on-screen text] notes, fitting the video length",
    "story": "a very short spoken script for a story video, scene by scene, fitting the video length",
    "carousel": "slide-by-slide text (Slide 1: ..., Slide 2: ...), 5 to 8 slides",
    "image": "the exact short text to place on the image (a headline and a sub-line)",
    "text": "an empty string",
}
EDIT_KEYS = (
    '"edit_plan" (an object with keys: "duration_seconds" (number), "aspect_ratio" (string), "broll" (array of 4-8 specific '
    'stock-footage search ideas, in order), "music_mood" (string), "sound_effects" (array of effect + where to use it), '
    '"transitions" (string), "caption_style" (string), "voice_notes" (string)), '
    '"image_idea" (a short visual idea or thumbnail description)'
)


def post_context(post):
    return (
        f"Format: {post['format']}\nContent type: {post['content_type']}\n"
        f"Topic: {post['topic'] or '(choose a strong, specific topic yourself)'}\n"
        f"Platforms: {', '.join(post['platforms']) or 'general'}\nVideo length: {post['duration']}"
    )


def build_prompt(post, step):
    brand = brand_context(get_brand())
    head = f"You are an expert social media content creator and video editor.\n{brand}\n{post_context(post)}\n"
    tail = "Write in the brand language and tone. Return ONLY a JSON object with these keys: "
    rule = SCRIPT_RULES[post["format"]]
    if step == "script":
        return (f"SCRIPT_REQUEST\n{head}{tail}"
                f'"topic" (string), "hook" (attention-grabbing first line), "script" ({rule}).')
    known = f"\nHook: {post['hook']}\nScript: {post['script']}\n"
    if step == "caption":
        return (f"CAPTION_REQUEST\n{head}{known}{tail}"
                '"caption" (full caption with line breaks), "hashtags" (array of 8-12), "cta" (one call-to-action line).')
    if step == "edit":
        return f"EDIT_REQUEST\n{head}{known}{tail}{EDIT_KEYS}."
    return (f"ALL_REQUEST\n{head}{tail}"
            f'"topic" (string), "hook", "script" ({rule}), "caption", "hashtags" (array of 8-12), "cta", {EDIT_KEYS}.')


def format_edit_plan(plan):
    if isinstance(plan, str):
        return plan
    if not isinstance(plan, dict):
        return ""

    def val(v):
        return "; ".join(str(x) for x in v) if isinstance(v, list) else str(v)

    labels = [
        ("duration_seconds", "Duration (sec)"), ("aspect_ratio", "Aspect ratio"), ("broll", "B-roll"),
        ("music_mood", "Background music"), ("sound_effects", "Sound effects"), ("transitions", "Transitions"),
        ("caption_style", "Caption style"), ("voice_notes", "Voice notes"),
    ]
    return "\n".join(f"{label}: {val(plan[key])}" for key, label in labels if plan.get(key) not in (None, "", []))


def ai_generate_post(post_id, step="all"):
    """Ek step (ya poora content) likhta hai aur post me save karta hai."""
    post = get_post(post_id)
    if not post:
        raise AIError("post not found")
    data = call_gemini(build_prompt(post, step))
    if isinstance(data, list) and data and isinstance(data[0], dict):
        data = data[0]
    if not isinstance(data, dict):
        raise AIError("The AI response had the wrong format. Please try again.")
    fields = {}
    if not post["topic"] and data.get("topic"):
        fields["topic"] = str(data["topic"])[:300]
    for key in ("hook", "script", "caption", "cta", "image_idea"):
        if key in data:
            fields[key] = str(data[key])
    if "hashtags" in data:
        tags = data["hashtags"]
        fields["hashtags"] = " ".join(str(t) for t in tags) if isinstance(tags, list) else str(tags)
    if "edit_plan" in data:
        fields["edit_plan"] = format_edit_plan(data["edit_plan"])
    if post["status"] == "idea" and fields:
        fields["status"] = "draft"
    return update_post(post_id, fields)


ASPECTS = {"story": "9:16", "video": "16:9", "text": "1:1"}


def slide_texts(post):
    """Carousel script se slide-wise text, warna ek hi text."""
    lines = lambda t: [x.strip() for x in re.split(r"\n+", t) if x.strip()]
    if post["format"] == "carousel" and post["script"]:
        parts = [x.strip() for x in re.split(r"(?im)^\s*slide\s*\d+\s*[:.\-\u2013]?", post["script"]) if x.strip()]
        if len(parts) >= 2:
            return [" - ".join(lines(x)[:2]) for x in parts[:8]]
    if post["format"] == "image" and post["script"]:
        return [" - ".join(lines(post["script"])[:2])]
    return [post["hook"] or post["topic"]]


def build_image_prompt(post, text, idx, total, note):
    brand = get_brand()
    kind = {"video": "YouTube thumbnail / video cover", "story": "vertical story", "carousel": "carousel slide",
            "image": "post image", "text": "post image"}[post["format"]]
    series = f" This is slide {idx + 1} of {total} in one carousel: keep exactly the same visual style, colors and layout across all slides." if total > 1 else ""
    return (
        f"Create a professional, scroll-stopping social media {kind} for {', '.join(post['platforms']) or 'social media'}.{series}\n"
        f"Business: {brand['business'] or brand['name'] or 'general'}. Audience: {brand['audience'] or 'general'}. Tone: {brand['tone']}.\n"
        f"Topic: {post['topic']}. Content type: {post['content_type']}.\n"
        f"Put this text on the image, large, readable and spelled exactly: \"{text}\"\n"
        "Modern, clean, high-quality design with strong visual hierarchy and good contrast. "
        "No watermarks, no extra random text, no logos of other brands."
        + (f"\nExtra request from the user: {note}" if note else "")
    )


def ai_generate_images(post_id, note="", on_progress=None):
    post = get_post(post_id)
    if not post:
        raise AIError("post not found")
    texts = slide_texts(post)
    aspect = ASPECTS.get(post["format"], "4:5")
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    names = []
    for i, text in enumerate(texts):
        png = generate_image(build_image_prompt(post, text, i, len(texts), note), aspect)
        name = f"post{post_id}-{int(time.time())}-{i + 1}.png"
        (IMAGES_DIR / name).write_bytes(png)
        names.append(name)
        if on_progress:
            on_progress(i + 1, len(texts))
    with DB_LOCK, db() as con:
        con.execute("UPDATE posts SET images = ? WHERE id = ?", (json.dumps(names), post_id))
    return names


# ---------- free video tools ----------

def tools_status():
    mock = os.environ.get("SOCIAL_STUDIO_MOCK_TTS") == "1"
    voices = [{"id": "edge:mock", "label": "Mock voice", "lang": "en"}] if mock else vid.list_voices()
    music = sorted(f.name for f in MUSIC_DIR.glob("*") if f.suffix.lower() in MUSIC_EXT) if MUSIC_DIR.exists() else []
    return {"ffmpeg": bool(vid.find_ffmpeg(DATA)), "edge": vid.edge_available(), "voices": voices,
            "default_voice": vid.default_voice(get_brand()["language"], voices), "music": music, "system": platform.system()}


def save_music(name, b64):
    clean = re.sub(r"[^\w.\- ]", "_", Path(name).name)
    if Path(clean).suffix.lower() not in MUSIC_EXT:
        raise ValueError("music must be mp3, wav, m4a or ogg")
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)
    (MUSIC_DIR / clean).write_bytes(base64.b64decode(b64))
    return clean


def video_job(post_id, scenes, voice, music, quality):
    def work(job_id):
        found = vid.find_ffmpeg(DATA)
        if not found:
            raise AIError("FFmpeg is not installed. Open Settings and click 'Install FFmpeg'.")
        ffmpeg, ffprobe = found
        music_arg = None
        if music == "ambient":
            music_arg = "ambient"
        elif music and music != "none":
            path = MUSIC_DIR / Path(music).name
            music_arg = str(path) if path.is_file() else None
        folder = DATA / "tmp" / job_id
        folder.mkdir(parents=True, exist_ok=True)
        try:
            job_update(job_id, post_ids=[post_id], stage="voice", total=len(scenes), done=0)
            prepared = []
            for i, sc in enumerate(scenes):
                image, audio = folder / f"s{i}.png", folder / f"a{i}.mp3"
                image.write_bytes(base64.b64decode(sc["image"].split(",", 1)[1]))
                vid.synth(sc["text"], voice, audio, ffmpeg)
                prepared.append({"image": str(image), "audio": str(audio), "slot": vid.duration(ffprobe, audio) + vid.PAD_SECS})
                job_incr(job_id, "done")
            job_update(job_id, stage="editing", done=0, total=100)
            whoosh = folder / "whoosh.wav"
            vid.make_whoosh(ffmpeg, whoosh)
            VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
            name = f"post{post_id}-{int(time.time())}.mp4"
            vid.compose(ffmpeg, prepared, VIDEOS_DIR / name, music_arg, 1920 if quality == "high" else 1280, str(whoosh),
                        lambda d, n: job_update(job_id, done=d, total=n))
            with DB_LOCK, db() as con:
                con.execute("UPDATE posts SET video = ? WHERE id = ?", (name, post_id))
            job_update(job_id, done=100)
        except vid.VideoError as e:
            raise AIError(str(e))
        finally:
            shutil.rmtree(folder, ignore_errors=True)
    return work


def ffmpeg_job():
    def work(job_id):
        job_update(job_id, stage="downloading")
        try:
            vid.download_ffmpeg(DATA, lambda d, n: job_update(job_id, done=int(d * 100 / n), total=100))
        except vid.VideoError as e:
            raise AIError(str(e))
    return work


def voices_job():
    def work(job_id):
        job_update(job_id, stage="installing")
        try:
            vid.install_edge()
        except vid.VideoError as e:
            raise AIError(str(e))
    return work


# ---------- background jobs ----------
# Lamba kaam (AI likhna) background thread me hota hai, screen band/switch karne par bhi chalta rehta hai.

JOBS = {}
JOBS_LOCK = threading.Lock()
POOL = ThreadPoolExecutor(max_workers=4)


def job_create(kind, label=""):
    job_id = uuid.uuid4().hex[:8]
    with JOBS_LOCK:
        JOBS[job_id] = {"id": job_id, "kind": kind, "label": label, "state": "running", "stage": "",
                        "done": 0, "total": 0, "failed": 0, "error": "", "post_ids": []}
        for old in list(JOBS)[:-40]:  # purane jobs saaf karo
            if JOBS[old]["state"] != "running":
                del JOBS[old]
    return job_id


def job_update(job_id, **kw):
    with JOBS_LOCK:
        JOBS[job_id].update(kw)


def job_snapshot(job_id):
    with JOBS_LOCK:
        return dict(JOBS[job_id])


def job_incr(job_id, key):
    with JOBS_LOCK:
        JOBS[job_id][key] += 1


def job_run(job_id, fn):
    try:
        fn()
        job_update(job_id, state="done")
    except AIError as e:
        job_update(job_id, state="error", error=str(e))
    except Exception:
        traceback.print_exc()
        job_update(job_id, state="error", error="Unexpected error. Please try again.")


def start_job(kind, label, fn):
    job_id = job_create(kind, label)
    POOL.submit(job_run, job_id, lambda: fn(job_id))
    return job_id


def generate_job(post_id, step, note=""):
    def work(job_id):
        post = get_post(post_id)
        wants_text = step != "image"
        wants_image = step == "image" or (step == "all" and post["format"] != "video")
        job_update(job_id, post_ids=[post_id], stage="writing", total=1)
        set_gen(post_id, "running")
        try:
            if wants_text:
                ai_generate_post(post_id, step)
            if wants_image:
                job_update(job_id, stage="imaging")
                ai_generate_images(post_id, note, lambda i, n: job_update(job_id, done=i, total=n))
        except AIError as e:
            set_gen(post_id, "error", str(e))
            raise
        set_gen(post_id, "done")
        job_update(job_id, done=job_snapshot(job_id)["total"])
    return work


def plan_job(month, theme, per_week, full):
    def work(job_id):
        job_update(job_id, stage="planning")
        posts = ai_plan_month(month, theme, per_week)
        job_update(job_id, post_ids=[p["id"] for p in posts], total=len(posts) if full else 0,
                   stage="writing" if full else "")
        if not full:
            return
        for p in posts:
            set_gen(p["id"], "queued")

        def one(p):
            set_gen(p["id"], "running")
            try:
                ai_generate_post(p["id"], "all")
                set_gen(p["id"], "done")
            except AIError as e:
                set_gen(p["id"], "error", str(e))
                job_incr(job_id, "failed")
            job_incr(job_id, "done")

        with ThreadPoolExecutor(max_workers=3) as ex:
            list(ex.map(one, posts))
    return work


# ---------- HTTP ----------

MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_download(self, text, filename):
        body = text.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self, limit=1_000_000):
        length = int(self.headers.get("Content-Length") or 0)
        if length > limit:
            raise ValueError("body too large")
        return json.loads(self.rfile.read(length) or b"{}")

    def handle_api(self, method):
        path = self.path.split("?")[0]
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        try:
            if method == "GET" and path == "/api/config":
                return self.send_json({
                    "formats": FORMATS, "content_types": CONTENT_TYPES, "platforms": PLATFORMS,
                    "statuses": STATUSES, "durations": DURATIONS, "brand": get_brand(), "has_key": bool(get_api_key()),
                })
            if method == "GET" and path == "/api/diagnose":  # "Test my key": kya-kya chal sakta hai
                if os.environ.get("SOCIAL_STUDIO_MOCK") == "1":
                    return self.send_json({"text_models": ["mock-flash"], "image_models": ["mock-image"], "text_ok": True, "text_error": ""})
                key = get_api_key()
                if not key:
                    raise AIError("No Gemini API key found. Add your key on the Settings page.")
                out = {"text_models": available_models(key, True), "image_models": available_image_models(key, True),
                       "text_ok": True, "text_error": ""}
                try:
                    call_gemini('Reply with JSON {"ok": true}')
                except AIError as e:
                    out["text_ok"], out["text_error"] = False, str(e)
                return self.send_json(out)
            if method == "GET" and path == "/api/tools":
                return self.send_json(tools_status())
            if method == "POST" and path == "/api/tools/ffmpeg":
                return self.send_json({"job": start_job("tools", "FFmpeg", lambda job_id: ffmpeg_job()(job_id))})
            if method == "POST" and path == "/api/tools/voices":
                return self.send_json({"job": start_job("tools", "Voices", lambda job_id: voices_job()(job_id))})
            if method == "POST" and path == "/api/music":
                body = self.read_json(limit=30_000_000)
                return self.send_json({"name": save_music(str(body.get("name", "")), str(body.get("data", "")))})
            if method == "PUT" and path == "/api/brand":
                return self.send_json(save_brand(self.read_json()))
            if method == "POST" and path == "/api/settings/key":
                key = str(self.read_json().get("key", "")).strip()
                save_settings({"gemini_api_key": key})
                _model_cache.clear()
                _image_model_cache.clear()
                return self.send_json({"has_key": bool(key)})
            if method == "GET" and path == "/api/posts":
                m = re.search(r"month=(\d{4}-\d{2})", query)
                if not m:
                    return self.send_json({"error": "month is required (YYYY-MM)"}, 400)
                return self.send_json(list_posts(m.group(1)))
            if method == "POST" and path == "/api/posts":
                return self.send_json(create_post(self.read_json()), 201)

            # --- quick create (calendar ke bina, aaj ka ek content) ---
            if method == "POST" and path == "/api/quick":
                body = self.read_json()
                brand = get_brand()
                post = create_post({
                    "date": date.today().isoformat(),
                    "format": body.get("format", "video"),
                    "content_type": body.get("content_type", "educational"),
                    "topic": str(body.get("topic", ""))[:600],
                    "duration": body.get("duration", "30-60 sec"),
                    "platforms": body.get("platforms", brand["platforms"]),
                })
                result = {"post": post, "job": None}
                if body.get("mode") == "auto":
                    result["job"] = start_job("generate", post["topic"] or "Content", generate_job(post["id"], "all"))
                return self.send_json(result, 201)

            # --- jobs ---
            if method == "POST" and path == "/api/jobs/plan":
                body = self.read_json()
                month = str(body.get("month", ""))
                if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
                    return self.send_json({"error": "invalid month"}, 400)
                per_week = max(1, min(7, int(body.get("posts_per_week", 4))))
                theme = str(body.get("theme", ""))[:200]
                job = start_job("plan", "Month plan", plan_job(month, theme, per_week, bool(body.get("full", True))))
                return self.send_json({"job": job})
            if method == "GET" and path == "/api/jobs":
                with JOBS_LOCK:
                    return self.send_json([dict(j) for j in JOBS.values() if j["state"] == "running"])
            m = re.fullmatch(r"/api/jobs/([0-9a-f]+)", path)
            if m and method == "GET":
                with JOBS_LOCK:
                    job = dict(JOBS[m.group(1)]) if m.group(1) in JOBS else None
                return self.send_json(job) if job else self.send_json({"error": "job not found"}, 404)

            m = re.fullmatch(r"/api/posts/(\d+)(/generate|/export|/video)?", path)
            if m:
                post_id, action = int(m.group(1)), m.group(2)
                if action == "/generate" and method == "POST":
                    post = get_post(post_id)
                    if not post:
                        return self.send_json({"error": "post not found"}, 404)
                    body = self.read_json()
                    step = body.get("step", "all")
                    if step not in STEPS:
                        return self.send_json({"error": "invalid step"}, 400)
                    note = str(body.get("note", ""))[:500]
                    job = start_job("generate", post["topic"] or "Content", generate_job(post_id, step, note))
                    return self.send_json({"job": job})
                if action == "/video" and method == "POST":
                    if not get_post(post_id):
                        return self.send_json({"error": "post not found"}, 404)
                    body = self.read_json(limit=60_000_000)
                    scenes = body.get("scenes")
                    if not isinstance(scenes, list) or not 1 <= len(scenes) <= 30:
                        return self.send_json({"error": "scenes must be a list of 1 to 30 items"}, 400)
                    clean = []
                    for sc in scenes:
                        text, image = str(sc.get("text", "")).strip()[:1200], str(sc.get("image", ""))
                        if not text or not image.startswith("data:image/png;base64,"):
                            return self.send_json({"error": "each scene needs text and a PNG image"}, 400)
                        clean.append({"text": text, "image": image})
                    voice = str(body.get("voice", ""))[:80]
                    quality = "high" if body.get("quality") == "high" else "standard"
                    job = start_job("video", "Video", video_job(post_id, clean, voice, str(body.get("music", "none")), quality))
                    return self.send_json({"job": job})
                if action == "/export" and method == "GET":
                    post = get_post(post_id)
                    if not post:
                        return self.send_json({"error": "post not found"}, 404)
                    return self.send_download(export_text(post), f"content-{post['date']}-{post_id}.txt")
                if method == "GET" and not action:
                    post = get_post(post_id)
                    return self.send_json(post) if post else self.send_json({"error": "post not found"}, 404)
                if method == "PUT" and not action:
                    post = update_post(post_id, self.read_json())
                    return self.send_json(post) if post else self.send_json({"error": "post not found"}, 404)
                if method == "DELETE" and not action:
                    delete_post(post_id)
                    return self.send_json({"ok": True})
            return self.send_json({"error": "not found"}, 404)
        except AIError as e:
            return self.send_json({"error": str(e)}, 502)
        except (ValueError, KeyError, TypeError) as e:
            return self.send_json({"error": f"invalid data: {e}"}, 400)

    def serve_static(self):
        rel = self.path.split("?")[0].lstrip("/") or "index.html"
        target = (STATIC / rel).resolve()
        if STATIC.resolve() not in target.parents or not target.is_file():
            self.send_response(404)
            self.end_headers()
            return
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(target.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_media(self, folder, ext, ctype):
        name = self.path.split("?")[0].rsplit("/", 1)[-1]
        target = (folder / name).resolve()
        if not re.fullmatch(r"[\w\-]+\." + ext, name) or folder.resolve() not in target.parents or not target.is_file():
            self.send_response(404)
            self.end_headers()
            return
        size = target.stat().st_size
        start, end, status = 0, size - 1, 200
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if m and (m.group(1) or m.group(2)):  # video seek ke liye
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            end = min(end, size - 1)
            status = 206
        with open(target, "rb") as f:
            f.seek(start)
            body = f.read(end - start + 1)
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(len(body)))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        if "download=1" in self.path:
            self.send_header("Content-Disposition", f'attachment; filename="{name}"')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/files/"):
            return self.serve_media(IMAGES_DIR, "png", "image/png")
        if self.path.startswith("/videos/"):
            return self.serve_media(VIDEOS_DIR, "mp4", "video/mp4")
        self.handle_api("GET") if self.path.startswith("/api/") else self.serve_static()

    def do_POST(self):
        self.handle_api("POST")

    def do_PUT(self):
        self.handle_api("PUT")

    def do_DELETE(self):
        self.handle_api("DELETE")


def main():
    init_db()
    # 127.0.0.1: tool sirf aapke apne computer par khulega, bahar se koi nahi dekh sakta.
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://localhost:{PORT}"
    print(f"Social Studio is running: {url}\nPress Ctrl+C to stop.")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
