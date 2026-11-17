import re, json, sys, time, subprocess, urllib.parse, datetime as dt
import openpyxl
import xml.etree.ElementTree as ET

DATA = sys.argv[1]
wb = openpyxl.load_workbook("/home/user/hsim-internship/HSIM_Competitor_Creator_List.xlsx")
chans = []; seen = set()
for ws in wb.worksheets[1:]:
    for r in range(4, 14):
        name = ws.cell(r, 2).value; link = ws.cell(r, 7).hyperlink.target
        q = urllib.parse.parse_qs(urllib.parse.urlparse(link).query)["search_query"][0]
        if name in seen: continue
        seen.add(name); chans.append({"name": name, "query": q, "sheet": ws.title})
# fixed handles supplied by user
fixed = {"HSIM": "@hsim.official"}
chans.insert(0, {"name": "HSIM", "query": "hsim.official", "sheet": "self"})
for n, h in (("Alex Hormozi", "@alexhormozi"),):
    chans.append({"name": n, "query": n, "sheet": "user-given", "handle": h})

def get(url):
    r = subprocess.run(["curl", "-sS", "-m", "40", "-L", url], capture_output=True, text=True)
    return r.stdout
def ydata(html):
    m = re.search(r'var ytInitialData = (\{.*?\});</script>', html, re.S)
    return json.loads(m.group(1)) if m else None
def walk(o, key, out):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == key: out.append(v)
            walk(v, key, out)
    elif isinstance(o, list):
        for v in o: walk(v, key, out)

res = []
for c in chans:
    out = dict(c); print("->", c["name"], flush=True)
    try:
        if c["name"] == "HSIM": cid_html = get("https://www.youtube.com/@hsim.official")
        elif "handle" in c: cid_html = get("https://www.youtube.com/" + c["handle"])
        else:
            html = get("https://www.youtube.com/results?search_query=" + urllib.parse.quote_plus(c["query"]) + "&sp=EgIQAg%253D%253D")
            d = ydata(html); lst = []; walk(d, "channelRenderer", lst) if d else None
            if not lst: out["error"] = "no channel found"; res.append(out); continue
            ch = lst[0]
            out["matched_title"] = ch.get("title", {}).get("simpleText")
            out["channelId"] = ch.get("channelId")
            out["handle"] = (ch.get("customUrl") or ch.get("navigationEndpoint", {}).get("browseEndpoint", {}).get("canonicalBaseUrl") or "")
            out["subs_text"] = (ch.get("videoCountText") or ch.get("subscriberCountText") or {}).get("simpleText")
            cid_html = None
        if cid_html is not None:
            d = ydata(cid_html)
            m = re.search(r'"channelId":"(UC[\w-]{22})"', cid_html); out["channelId"] = m.group(1) if m else None
            cm = []; walk(d, "channelMetadataRenderer", cm) if d else None
            out["matched_title"] = cm[0].get("title") if cm else None
            out["handle"] = c.get("handle") or "@hsim.official"
            sub = re.search(r'([\d.,]+[KMB]? subscribers)', cid_html); out["subs_text"] = sub.group(1) if sub else None
        cid = out.get("channelId")
        # RSS upload frequency
        if cid:
            rss = get("https://www.youtube.com/feeds/videos.xml?channel_id=" + cid)
            try:
                root = ET.fromstring(rss); ns = {"a": "http://www.w3.org/2005/Atom", "m": "http://search.yahoo.com/mrss/"}
                vids = []
                for e in root.findall("a:entry", ns):
                    vids.append({"title": e.find("a:title", ns).text, "published": e.find("a:published", ns).text,
                                 "views": (e.find("m:group/m:community/m:statistics", ns).attrib.get("views") if e.find("m:group/m:community/m:statistics", ns) is not None else None)})
                out["videos"] = vids
            except Exception as ex: out["rss_error"] = str(ex)[:80]
            # posts
            ph = get("https://www.youtube.com/channel/" + cid + "/posts")
            d = ydata(ph); posts = []
            if d:
                bs = []; walk(d, "backstagePostRenderer", bs)
                for p in bs:
                    att = p.get("backstageAttachment") or {}
                    kind = next(iter(att.keys()), "text").replace("Renderer", "") if att else "text"
                    txt = "".join(r.get("text", "") for r in p.get("contentText", {}).get("runs", []))
                    posts.append({"time": (p.get("publishedTimeText", {}).get("runs", [{}])[0].get("text")),
                                  "type": kind, "text": txt[:160],
                                  "likes": p.get("voteCount", {}).get("simpleText"),
                                  "comments": ((p.get("actionButtons", {}).get("commentActionButtonsRenderer", {}).get("replyButton", {}).get("buttonRenderer", {}).get("text", {}) or {}).get("simpleText"))})
                tabs = []; walk(d, "tabRenderer", tabs)
                out["has_posts_tab"] = any((t.get("title") or "").lower() in ("posts", "community") for t in tabs)
                out["posts_page_ok"] = True
            out["posts"] = posts
    except Exception as ex:
        out["error"] = str(ex)[:120]
    res.append(out); time.sleep(1.2)
    json.dump(res, open(DATA + "/channels.json", "w"), ensure_ascii=False, indent=1)
print("DONE")
