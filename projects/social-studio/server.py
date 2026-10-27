"""Social Studio: Phase 1 (Brand profile + Monthly calendar + AI content writer).

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
import urllib.error
import urllib.request
import webbrowser
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
MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"]

DB_LOCK = threading.Lock()


# ---------- storage ----------

def db():
    DATA.mkdir(exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


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
    "date", "format", "content_type", "topic", "platforms", "status", "time",
    "hook", "caption", "hashtags", "cta", "script", "image_idea",
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
        elif key == "date":
            date.fromisoformat(str(val))  # galat date par ValueError -> 400
        elif key == "time":
            if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(val)):
                val = "10:00"
        else:
            val = str(val)
        out[key] = val
    if not partial and "date" not in out:
        raise ValueError("date zaroori hai")
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


def call_gemini(prompt):
    """Prompt bhejta hai, JSON (dict/list) wapas deta hai."""
    if os.environ.get("SOCIAL_STUDIO_MOCK") == "1":
        return mock_ai(prompt)
    key = get_api_key()
    if not key:
        raise AIError("Gemini API key nahi mili. Settings page par key daalo.")
    last_error = "unknown error"
    for model in MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        body = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.9},
        }).encode()
        req = urllib.request.Request(
            url, data=body, method="POST",
            headers={"Content-Type": "application/json", "x-goog-api-key": key},
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                payload = json.loads(resp.read())
            text = payload["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text)
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403):
                raise AIError("API key galat hai ya kaam nahi kar rahi. Settings me dobara check karo.")
            if e.code == 429:
                last_error = "Free limit poori ho gayi. Thodi der baad (ya kal) try karo."
                continue  # doosra model try karo
            last_error = f"Gemini error {e.code}"
        except (urllib.error.URLError, TimeoutError):
            raise AIError("Internet ya Gemini se connect nahi ho paya. Internet check karo.")
        except (KeyError, IndexError, ValueError):
            last_error = "AI ka jawab samajh nahi aaya. Dobara try karo."
    raise AIError(last_error)


def mock_ai(prompt):
    """Test ke liye: asli AI ke bina nakli jawab."""
    if "PLAN_REQUEST" in prompt:
        return [
            {"day": 1, "format": "video", "content_type": "educational", "topic": "Mock topic 1"},
            {"day": 3, "format": "image", "content_type": "tips", "topic": "Mock topic 2"},
            {"day": 5, "format": "carousel", "content_type": "motivational", "topic": "Mock topic 3"},
        ]
    return {
        "hook": "Mock hook", "caption": "Mock caption", "hashtags": ["#mock", "#test"],
        "cta": "Follow karo!", "script": "Scene 1: ...", "image_idea": "Mock image idea",
    }


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
        raise AIError("AI ka jawab galat format me tha. Dobara try karo.")
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


def ai_generate_post(post):
    brand = get_brand()
    is_video = post["format"] in ("video", "story")
    prompt = f"""You are a social media copywriter.
{brand_context(brand)}
Post: format={post['format']}, type={post['content_type']}, topic="{post['topic']}", platforms={post['platforms']}.
Write in the brand language and tone. Return ONLY a JSON object with keys:
"hook" (attention-grabbing first line), "caption" (full caption, with line breaks), "hashtags" (array of 8-12 relevant hashtags),
"cta" (one call-to-action line), "script" ({'a spoken video script, scene by scene, 30-60 seconds' if is_video else 'empty string'}),
"image_idea" (a short visual idea / description of the image or video thumbnail)."""
    data = call_gemini(prompt)
    if not isinstance(data, dict):
        raise AIError("AI ka jawab galat format me tha. Dobara try karo.")
    tags = data.get("hashtags", [])
    if isinstance(tags, list):
        tags = " ".join(str(t) for t in tags)
    return update_post(post["id"], {
        "hook": str(data.get("hook", "")), "caption": str(data.get("caption", "")),
        "hashtags": str(tags), "cta": str(data.get("cta", "")),
        "script": str(data.get("script", "")), "image_idea": str(data.get("image_idea", "")),
        "status": "draft" if post["status"] == "idea" else post["status"],
    })


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
                    "statuses": STATUSES, "brand": get_brand(), "has_key": bool(get_api_key()),
                })
            if method == "PUT" and path == "/api/brand":
                return self.send_json(save_brand(self.read_json()))
            if method == "POST" and path == "/api/settings/key":
                key = str(self.read_json().get("key", "")).strip()
                save_settings({"gemini_api_key": key})
                return self.send_json({"has_key": bool(key)})
            if method == "GET" and path == "/api/posts":
                m = re.search(r"month=(\d{4}-\d{2})", query)
                if not m:
                    return self.send_json({"error": "month chahiye (YYYY-MM)"}, 400)
                return self.send_json(list_posts(m.group(1)))
            if method == "POST" and path == "/api/posts":
                return self.send_json(create_post(self.read_json()), 201)
            if method == "POST" and path == "/api/ai/plan":
                body = self.read_json()
                month = str(body.get("month", ""))
                if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
                    return self.send_json({"error": "month galat hai"}, 400)
                per_week = max(1, min(7, int(body.get("posts_per_week", 4))))
                return self.send_json(ai_plan_month(month, str(body.get("theme", ""))[:200], per_week))
            m = re.fullmatch(r"/api/posts/(\d+)(/generate)?", path)
            if m:
                post_id = int(m.group(1))
                if m.group(2) and method == "POST":
                    post = get_post(post_id)
                    return self.send_json(ai_generate_post(post)) if post else self.send_json({"error": "post nahi mila"}, 404)
                if method == "PUT":
                    post = update_post(post_id, self.read_json())
                    return self.send_json(post) if post else self.send_json({"error": "post nahi mila"}, 404)
                if method == "DELETE":
                    delete_post(post_id)
                    return self.send_json({"ok": True})
            return self.send_json({"error": "not found"}, 404)
        except AIError as e:
            return self.send_json({"error": str(e)}, 502)
        except (ValueError, KeyError, TypeError) as e:
            return self.send_json({"error": f"galat data: {e}"}, 400)

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
    print(f"Social Studio chalu hai: {url}\nBand karne ke liye Ctrl+C dabao.")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBand ho gaya.")


if __name__ == "__main__":
    main()
