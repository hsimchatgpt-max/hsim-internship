"""Social Studio: content creator (quick create, step-by-step or automatic) + optional monthly calendar.

Sirf Python ki built-in libraries use hui hain, to koi `pip install` nahi chahiye.
Chalane ke liye:  python server.py   (phir browser me http://localhost:8000)
"""
import calendar
import json
import os
import re
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
STEPS = ["all", "script", "caption", "edit"]

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


DEFAULT_BRAND = {
    "name": "", "business": "", "audience": "", "tone": "friendly",
    "language": "hinglish", "platforms": ["instagram", "linkedin", "youtube"],
}


def get_brand():
    with DB_LOCK, db() as con:
        row = con.execute("SELECT data FROM brand WHERE id = 1").fetchone()
    return {**DEFAULT_BRAND, **(json.loads(row["data"]) if row else {})}


def save_brand(data):
    clean = {k: data.get(k, DEFAULT_BRAND[k]) for k in DEFAULT_BRAND}
    with DB_LOCK, db() as con:
        con.execute("INSERT OR REPLACE INTO brand (id, data) VALUES (1, ?)", (json.dumps(clean),))
    return clean


def row_to_post(row):
    post = dict(row)
    post["platforms"] = json.loads(post["platforms"] or "[]")
    return post


POST_FIELDS = [
    "date", "format", "content_type", "topic", "platforms", "status", "time", "duration",
    "hook", "caption", "hashtags", "cta", "script", "image_idea", "edit_plan",
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


def available_models(key, refresh=False):
    """Google se poochta hai ki is key par kaun se models chal sakte hain (cache karke)."""
    if _model_cache and not refresh:
        return list(_model_cache)
    req = urllib.request.Request(API_ROOT + "/models?pageSize=200", headers={"x-goog-api-key": key})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            models = json.loads(resp.read()).get("models", [])
    except urllib.error.HTTPError as e:
        if e.code in (400, 401, 403):
            raise AIError(KEY_ERROR)
        models = []
    except (urllib.error.URLError, TimeoutError):
        raise AIError("Could not connect to Gemini. Check your internet connection.")
    names = [
        m["name"].split("/", 1)[-1] for m in models
        if "generateContent" in m.get("supportedGenerationMethods", [])
        and m["name"].split("/", 1)[-1].startswith("gemini")
        and not any(w in m["name"] for w in SKIP_WORDS)
    ]
    names.sort(key=model_rank)
    chosen = names[:3] or list(MODELS)  # list na mile to purane naam try karo
    _model_cache[:] = chosen
    return list(chosen)


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
                        last_error = LIMIT_ERROR if e.code == 429 else BUSY_ERROR
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


def mock_ai(prompt):
    """Test ke liye: asli AI ke bina nakli jawab."""
    time.sleep(float(os.environ.get("MOCK_DELAY", "0")))
    plan = {"topic": "Mock topic"}
    script = {"hook": "Mock hook", "script": "Scene 1: ..."}
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


def generate_job(post_id, step):
    def work(job_id):
        job_update(job_id, post_ids=[post_id], stage="writing", total=1)
        set_gen(post_id, "running")
        try:
            ai_generate_post(post_id, step)
        except AIError as e:
            set_gen(post_id, "error", str(e))
            raise
        set_gen(post_id, "done")
        job_incr(job_id, "done")
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

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 1_000_000:
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
            if method == "PUT" and path == "/api/brand":
                return self.send_json(save_brand(self.read_json()))
            if method == "POST" and path == "/api/settings/key":
                key = str(self.read_json().get("key", "")).strip()
                save_settings({"gemini_api_key": key})
                _model_cache.clear()
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
                    "topic": str(body.get("topic", ""))[:300],
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

            m = re.fullmatch(r"/api/posts/(\d+)(/generate|/export)?", path)
            if m:
                post_id, action = int(m.group(1)), m.group(2)
                if action == "/generate" and method == "POST":
                    post = get_post(post_id)
                    if not post:
                        return self.send_json({"error": "post not found"}, 404)
                    step = self.read_json().get("step", "all")
                    if step not in STEPS:
                        return self.send_json({"error": "invalid step"}, 400)
                    job = start_job("generate", post["topic"] or "Content", generate_job(post_id, step))
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

    def do_GET(self):
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
