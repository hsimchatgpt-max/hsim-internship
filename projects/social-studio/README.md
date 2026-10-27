# Social Studio (Phase 1)

Social media content ka planner: **Brand Profile + Monthly Calendar + AI content writer**.
Free hai, aapke apne computer par chalta hai, Windows aur Mac dono par.

## Kya kar sakte ho
- **Create tab (simple):** calendar ke bina, abhi ek content banao. Topic likho (ya khali chhodo, AI chunega), format aur type chuno.
  - **Step by step:** pehle script, dekho/edit karo, phir caption + hashtags, phir editing plan. Har step ke baad aage jao.
  - **Fully automatic:** script, caption, hashtags, editing plan sab ek saath. Phir "Download content pack".
- **Calendar tab (optional):** jise aage ka plan chahiye. "Plan the month with AI" poore mahine ke posts banata hai **aur har post ka poora content bhi** (script, caption, editing plan). Calendar ya List view me sab dikhta hai, kisi par click karke edit karo.
- **Image Designer (Phase 2):** "Design image" button se post, carousel slides, story ya YouTube thumbnail banao. Brand colors + logo + font apne aap lagte hain; 4 templates, apni photo background me, aur PNG download (carousel ki saari slides ek saath). Brand Profile me colors, font aur logo ek baar set karo.
- Kaam **background me** chalta hai: AI likh raha ho tab tab badal sakte ho. Google busy ho to tool khud dobara try karta hai.
- Tool English me khulta hai; upar right me "English / हिंदी" switch se Hindi.
- Brand profile (business, audience, tone, language) se AI aapke jaisa likhta hai.

## Chalane ke steps (Windows)
1. Python install hona chahiye (`python --version` check karo).
2. Is folder (`social-studio`) ko apne computer par rakho.
3. `start.bat` par **double-click** karo. Browser me tool khul jayega (`http://localhost:8000`).
   - Na khule to Command Prompt me is folder me jaakar `python server.py` likho.
4. **Settings** tab me Gemini API key daalo (aistudio.google.com/apikey se free me milti hai).
5. **Brand Profile** bharo, phir **Create** tab me content banao.

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
