import html, datetime as dt
import make_30day as m
tag = {"Short": "s", "Long video": "l", "Community": "c"}
def week_of(d):
    for nm, a, b, *_ in m.weeks:
        if a <= d <= b: return nm
parts = []
cur = None
for d, fmt, ttl, det in m.rows:
    w = week_of(d)
    if w != cur:
        if cur: parts.append("</table>")
        parts.append(f"<h3>{html.escape(w)}</h3><table><tr><th>Date</th><th>Din</th><th>Time</th><th>Format</th><th>Topic / Title</th><th>Kya karna hai</th><th>Status</th></tr>")
        cur = w
    tm = "5:30 PM" if ttl.startswith("Video link post") else m.T[fmt]
    parts.append(f"<tr><td>{d.strftime('%d %b')}</td><td>{m.DAYS[d.weekday()]}</td><td>{tm}</td><td><span class='tag {tag[fmt]}'>{fmt}</span></td><td><b>{html.escape(ttl)}</b></td><td>{html.escape(det)}</td><td class='st'>[ ] Posted</td></tr>")
parts.append("</table>")
tot = {k: sum(1 for r in m.rows if r[1] == k) for k in ("Short", "Long video", "Community")}
page = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page{{size:A4 landscape;margin:10mm}}
body{{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#1b1b1b}}
h1{{color:#0a46af;font-size:20px;margin:0}} .sub{{color:#555;margin:2px 0 8px}}
h3{{color:#d71e5a;font-size:12px;margin:10px 0 3px;break-after:avoid}}
table{{border-collapse:collapse;width:100%;margin-bottom:4px;break-inside:avoid}}
th{{background:#0a46af;color:#fff;text-align:left;padding:4px;font-size:9.5px}}
td{{border:1px solid #c9d3e6;padding:4px;vertical-align:top}} tr:nth-child(even) td{{background:#f3f6fc}}
.tag{{display:inline-block;padding:1px 6px;border-radius:8px;color:#fff;font-weight:bold;font-size:9px;white-space:nowrap}}
.s{{background:#d71e5a}}.l{{background:#0a46af}}.c{{background:#2e8b57}}
.st{{white-space:nowrap;color:#777}} .box{{background:#fff4d6;border:1px solid #e6c35c;padding:6px;margin:6px 0}}
</style></head><body>
<h1>HSIM YouTube Calendar: 18 Nov se 17 Dec 2026 (30 din)</h1>
<div class="sub">Channel: @hsim.official | Kul: {tot['Short']} Shorts, {tot['Long video']} Long videos, {tot['Community']} Community posts</div>
<div class="box"><b>Dhyan rakhein:</b> Time (IST) andaza hai, 2 hafte baad YouTube Analytics dekh kar badlein. Titles mein [Shehar] ki jagah apna shehar likhein (Chandigarh ya Karnal). Salary jaise number likhne se pehle source dekh lein. Video link wali community post video aane ke baad (5:30 PM) daalein. Agla Long video: Shanivar 19 Dec, "Digital Marketing mein AI Tools ka use (Hindi)".</div>
{''.join(parts)}
</body></html>"""
open("calendar_30day.html", "w").write(page)
