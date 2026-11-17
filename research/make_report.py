import json, re, collections
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

SCR = "/tmp/claude-0/-home-user-hsim-internship/f3e7f033-4c09-5569-a445-fa3464e98990/scratchpad/data/analysis.json"
A = json.load(open(SCR))
TYPEMAP = {"backstageImage":"Image","postMultiImage":"Multi-image carousel","video":"Video share","poll":"Poll","text":"Text only","quiz":"Quiz"}
THEMES = [
 ("Course/offer/admission promo", r"offer|enrol|enroll|discount|coupon|course|batch|admission|register|join us|% off|scholarship|mentorship|masterclass|webinar|apply now|certified|certification|program"),
 ("Festival/greeting", r"diwali|holi\b|happy |wishes|greeting|celebrat|bless|chhath|children|bhai dooj|krishna|new year|शुभकामना|दीपावली|दिवाली|जयंती|festival"),
 ("Poll/question to audience", r"\?|which |what do you|kaun|kya aap|comment below|tell us|let us know|aap log"),
 ("Video link promo", r"youtu\.be|youtube\.com|watch|new video|full video|new vlog|live now|premiere"),
 ("Tips/education", r"tips|how to|steps|strategy|guide|learn|secret|kaise|roadmap|checklist|mistake"),
 ("News/update", r"news|breaking|update|google|ai overview|chatgpt|gemini|meta |openai|anthropic|claude"),
 ("Success story/proof", r"alumni|placed|placement|success|case study|revenue|earn|lakh|crore|journey|achievement|student"),
 ("Hiring/careers", r"hiring|we are hiring|jointeam|vacancy|job opening|internship"),
]
def theme(p):
    t = (p["text"] or "").lower()
    if p["type"] == "poll": return "Poll/question to audience"
    for name, rx in THEMES:
        if re.search(rx, t): return name
    return "Other"
def fmt_age(days):
    if days is None: return "-"
    if days < 1: return "Aaj (24 ghante ke andar)"
    if days < 14: return f"{int(round(days))} din pehle"
    if days < 60: return f"~{int(round(days/7))} hafte pehle"
    if days < 730: return f"~{int(round(days/30))} mahine pehle"
    return f"~{int(round(days/365))} saal pehle"
def status(r):
    if not r["has_posts_tab"] and r["n_posts"] == 0: return "Community tab nahi / koi post nahi"
    d = r.get("latest_post_days")
    if d is None: return "Pata nahi"
    if d <= 30: return "Active (pichhle 30 din mein post)"
    if d <= 180: return "Kabhi-kabhi (1-6 mahine)"
    return "Lagbhag band (6+ mahine se post nahi)"
def vid_rate(r):
    v = r.get("uploads_per_week")
    if v is None: return "-"
    if v >= 14: return "Rozana 2+ (zyada Shorts)"
    return f"{v}/hafta"
def post_rate(r):
    if r["n_posts"] == 0: return "-"
    d = r.get("latest_post_days")
    if d is not None and d > 180: return "Band"
    v = r.get("posts_per_week")
    if v is None: return "-"
    if v >= 14: return "Rozana 2+"
    if v < 0.1: return "Bahut kam (<1/mahina)"
    return f"{v}/hafta"

FONT="Arial"; thin=Side(style="thin",color="BBBBBB"); border=Border(left=thin,right=thin,top=thin,bottom=thin)
hdr=PatternFill("solid",fgColor="0A46AF"); alt=PatternFill("solid",fgColor="EEF3FB")
green=PatternFill("solid",fgColor="D9F2D9"); amber=PatternFill("solid",fgColor="FFF2CC"); red=PatternFill("solid",fgColor="F8D7DA"); me=PatternFill("solid",fgColor="FFE699")

wb=Workbook(); ws0=wb.active; ws0.title="Summary"

# ---- Activity sheet
ws=wb.create_sheet("Activity (sab channels)")
ws["A1"]="Channel activity: upload frequency aur community posts"; ws["A1"].font=Font(name=FONT,size=14,bold=True,color="0A46AF")
H=["Channel","Category","Handle / link","Video upload (RSS, Shorts included)","Last video upload","Community tab","Community status","Latest post","Posts frequency","Post types (last 10)","Avg likes/post","Mostly kya post karte hain","Sample post (latest)"]
W=[30,24,22,24,18,12,30,22,16,40,12,40,70]
for j,h in enumerate(H,1):
    c=ws.cell(3,j,h); c.font=Font(name=FONT,bold=True,color="FFFFFF"); c.fill=hdr; c.border=border; c.alignment=Alignment(wrap_text=True,vertical="center",horizontal="center")
    ws.column_dimensions[get_column_letter(j)].width=W[j-1]
ws.row_dimensions[3].height=36
rows=[r for r in A]
# HSIM first, then by category order
order={"self":0,"1 SEO Tools & Brands":1,"2 SEO Creators (India)":2,"3 SMM-SMO Creators (India)":3,"4 DM Institutes":4,"5 AI Creators (India)":5,"user-given":6}
rows.sort(key=lambda r:(order.get(r["sheet"],9)))
CAT={"self":"HSIM (aapka channel)","1 SEO Tools & Brands":"SEO tool/brand","2 SEO Creators (India)":"SEO creator (India)","3 SMM-SMO Creators (India)":"SMM creator (India)","4 DM Institutes":"DM institute","5 AI Creators (India)":"AI creator (India)","user-given":"Aapne diya (Hormozi)"}
for i,r in enumerate(rows,start=4):
    ps=r.get("posts") or []
    th=collections.Counter(theme(p) for p in ps)
    top=", ".join(f"{k} ({v})" for k,v in th.most_common(3)) if ps else "-"
    types=", ".join(f"{TYPEMAP.get(k,k)} {v}" for k,v in sorted((r.get('types') or {}).items(), key=lambda x:-x[1])) or "-"
    handle=r["handle"] if str(r["handle"]).startswith("@") else str(r["handle"]).lstrip("/")
    sample=(ps[0]["text"].replace("\n"," ")[:140] if ps else "-")
    vals=[r["name"],CAT.get(r["sheet"],r["sheet"]),None,vid_rate(r),fmt_age(r.get("last_upload_days")),"Haan" if r["has_posts_tab"] else "Nahi",status(r),fmt_age(r.get("latest_post_days")) if ps else "-",post_rate(r),types,r.get("avg_likes") if ps else "-",top,sample]
    for j,v in enumerate(vals,1):
        c=ws.cell(i,j,v); c.font=Font(name=FONT,bold=(r["sheet"]=="self")); c.border=border; c.alignment=Alignment(wrap_text=True,vertical="top")
        if r["sheet"]=="self": c.fill=me
        elif i%2==1: c.fill=alt
    lc=ws.cell(i,3,handle); lc.hyperlink=f"https://www.youtube.com/{handle}/posts"; lc.font=Font(name=FONT,color="0563C1",underline="single")
    st=ws.cell(i,7)
    if r["sheet"]!="self":
        st.fill = green if st.value.startswith("Active") else amber if st.value.startswith("Kabhi") else red
    ws.row_dimensions[i].height=60
ws.freeze_panes="B4"; ws.auto_filter.ref=f"A3:{get_column_letter(len(H))}{3+len(rows)}"

# ---- Posts sheet
wp=wb.create_sheet("Recent community posts")
wp["A1"]="Har channel ki recent community posts (max 10)"; wp["A1"].font=Font(name=FONT,size=14,bold=True,color="0A46AF")
HP=["Channel","Post kab","Type","Likes","Comments","Theme","Post text (shuruaat)"]; WP=[30,18,20,10,10,28,110]
for j,h in enumerate(HP,1):
    c=wp.cell(3,j,h); c.font=Font(name=FONT,bold=True,color="FFFFFF"); c.fill=hdr; c.border=border; c.alignment=Alignment(wrap_text=True,horizontal="center")
    wp.column_dimensions[get_column_letter(j)].width=WP[j-1]
k=4
for r in rows:
    for p in (r.get("posts") or []):
        vals=[r["name"],p["time"],TYPEMAP.get(p["type"],p["type"]),p["likes"] or "0",p["comments"] or "0",theme(p),(p["text"] or "").replace("\n"," ")]
        for j,v in enumerate(vals,1):
            c=wp.cell(k,j,v); c.font=Font(name=FONT); c.border=border; c.alignment=Alignment(wrap_text=True,vertical="top")
            if k%2==1: c.fill=alt
        k+=1
wp.freeze_panes="B4"; wp.auto_filter.ref=f"A3:G{k-1}"

# ---- Summary
def S(r,c,v,bold=False,size=11,color=None,fill=None,wrap=True):
    x=ws0.cell(r,c,v); x.font=Font(name=FONT,bold=bold,size=size,color=color); x.alignment=Alignment(wrap_text=wrap,vertical="top")
    if fill: x.fill=fill
    return x
S(1,1,"HSIM: Channel activity report (upload + community posts)",True,16,"0A46AF")
S(2,1,"Data: YouTube ke public pages aur RSS feed se, 17 November 2026 ko liya gaya.",False,10)
act=[r for r in A if r["sheet"]!="self"]
active=[r for r in act if status(r).startswith("Active")]
sometimes=[r for r in act if status(r).startswith("Kabhi")]
dead=[r for r in act if status(r).startswith("Lagbhag") or status(r).startswith("Community tab")]
hs=[r for r in A if r["sheet"]=="self"][0]
lines=[
("HSIM abhi", f"Videos: {vid_rate(hs)} (RSS ke last 15 videos ke hisaab se). Community tab: {'hai' if hs['has_posts_tab'] else 'nahi hai / koi post nahi'}. Subscribers: 594."),
("Kitne channels", f"{len(act)} channels check kiye. Community mein ACTIVE (30 din mein post): {len(active)}. Kabhi-kabhi: {len(sometimes)}. Lagbhag band / tab nahi: {len(dead)}."),
("Sabse zyada community posts", "Simplilearn, upGrad, Ankur Warikoo, Alok Badatia, Raj Shamani, Alex Hormozi, WsCube Tech, Technical Guruji. Ye roz ya haftay mein kai post daalte hain."),
("Sabse achhi engagement", "Raj Shamani, Technical Guruji, Trakin Tech, Manoj Dey, Satish K Videos (har post par hazaaron likes). Hindi educators mein Manoj Dey aur Satish K Videos sabse aage hain."),
("Hindi DM competitors ka pattern", "WsCube: din mein kai (4-6) image posts (course promo + AI/career tips). Alok Badatia: roz polls + mentorship ki photos. Marketing Fundas: polls ('agla course kaun sa?'). Manoj Dey/Satish: festival wishes + offers + video links."),
("Bade institutes ka pattern", "upGrad aur Simplilearn: har video ka link ek image post ke saath; Simplilearn: roz course 'Enroll Now' carousels. DIDM: festival wishes. Digital Vidya/IIDE: lagbhag band (saal bhar purani posts)."),
("Post kaisi hoti hai", "Zyadatar: ek image (poster) + 2-4 line caption + link. Phir carousel (multi-image), polls (sawal), aur video link. Sirf text posts kam hain."),
("HSIM ke liye plan", "1) Community tab on karein (Settings, Channel, Feature eligibility). 2) Haftay mein 3 post: Mon poll ('Kaunsa course?'), Wed tip poster, Fri student result/classroom photo + 16 Nov opening update. 3) Har video ke saath ek image post. 4) Festival wishes. 5) Admission/demo class ka link har post mein."),
("Dhyan rakhein", "Video upload frequency RSS ke last 15 items se nikali hai, jisme Shorts bhi shamil hain. Post frequency last 10 posts ke time se nikali hai, isliye purani posts wale channels 'Band' dikhte hain. Time 'x din pehle' jaise approximate hain. Subscribers/likes badalte rehte hain."),
("Nahi mile", "Master Blogger, Mr Mradul, Digital Deepak Internet Business School aur PW Skills ka sahi YouTube channel confirm nahi ho paya, isliye unhe hata diya. Search Engine Journal, Yoast, Ankit Arora, Screaming Frog, Kunjal Chawhan par community tab nahi hai."),
]
for i,(k_,v) in enumerate(lines,start=4):
    S(i,1,k_,True); S(i,2,v); ws0.row_dimensions[i].height=62
ws0.column_dimensions["A"].width=28; ws0.column_dimensions["B"].width=120
ws0.move_range  # no-op
wb.move_sheet("Summary",offset=-wb.index(wb["Summary"]))
wb.save("/home/user/hsim-internship/HSIM_Channel_Activity_Report.xlsx"); print("saved", len(rows), k-4)
