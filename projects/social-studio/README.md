# Social Studio (Phase 1)

Social media content ka planner: **Brand Profile + Monthly Calendar + AI content writer**.
Free hai, aapke apne computer par chalta hai, Windows aur Mac dono par.

## Kya kar sakte ho (Phase 1)
- Brand profile set karo (business, audience, tone, language)
- Month ka calendar: har din ke liye format (image/video/carousel/text/story) aur content type chuno
- "AI se mahine ka plan banao": poore mahine ke topics apne aap
- Post ko drag karke doosre din par rakho
- "AI se content likho": hook, caption, hashtags, CTA, video script, image idea

## Chalane ke steps (Windows)
1. Python install hona chahiye (`python --version` check karo).
2. Is folder (`social-studio`) ko apne computer par rakho.
3. `start.bat` par **double-click** karo. Browser me tool khul jayega (`http://localhost:8000`).
   - Na khule to Command Prompt me is folder me jaakar `python server.py` likho.
4. **Settings** tab me Gemini API key daalo (aistudio.google.com/apikey se free me milti hai).
5. **Brand Profile** bharo, phir Calendar me kaam shuru.

## Mac
Terminal me folder me jaakar: `python3 server.py`

## Band karna
Command Prompt wali window me `Ctrl + C`, ya window band kar do.

## Files ka matlab
| File | Kaam |
|------|------|
| `server.py` | Tool ka dimaag: data save karta hai, AI (Gemini) ko bulata hai |
| `static/index.html` | Jo screen aap dekhte ho |
| `start.bat` / `start.command` | Double-click se chalane ke liye |
| `data/` | Aapke posts aur API key (sirf aapke computer par, GitHub par nahi jaata) |

## Aage ke phases
Image posts, voice, avatar, auto-edit, direct posting, auto-post scheduler.
