import datetime as dt
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule
from openpyxl.utils import get_column_letter

D = lambda m, d: dt.date(2026, m, d)
DAYS = ["Somvar", "Mangalvar", "Budhvar", "Guruvar", "Shukravar", "Shanivar", "Ravivar"]
S, L, C = "Short", "Long video", "Community"
T = {S: "6:00 PM", L: "5:00 PM", C: "12:00 PM"}
rows = [
 # launch days
 (D(11,18), S, "Digital Marketing kya hota hai? 30 second mein", "Hook: 'Instagram aur Google par jo ads dikhte hain, wo kaun banata hai?' 20-30 sec. Aakhir mein: 'Poora course HSIM mein'. Screen par HSIM logo."),
 (D(11,19), C, "Poster: Digital Marketing seekhne ke 4 fayde", "1 image, 4 points: job, freelancing, apna business, kam investment. Caption 2-3 line aur WhatsApp link."),
 (D(11,20), S, "HSIM classroom / lab ka 20 second tour", "Camera se classroom aur computer lab dikhayein. Text: 'HSIM mein practical kaam hota hai'."),
 (D(11,21), L, "HSIM kya hai? Digital Marketing Course in [Shehar] | Syllabus, Fees, Demo Class", "Outline: HSIM intro, courses, syllabus, kaun seekh sakta hai, demo class, contact. Isi video ko channel trailer bhi banayein."),
 (D(11,21), C, "Video link post: HSIM kya hai?", "Video ka thumbnail + 1 line + sawal 'Aap kaunsa course sikhna chahte hain?'. Link daalein."),
 (D(11,22), S, "Free demo class kaise book karein?", "3 steps: WhatsApp karein, slot chunein, class mein aayein. Number screen par."),
 (D(11,22), C, "Demo class ki date + WhatsApp link", "Image: date, time, address, WhatsApp number."),
 # week 1
 (D(11,23), S, "Google par website rank kaise hoti hai?", "Hook: 'Google ek website ko upar kyun dikhata hai?' 3 baatein: content, links, speed."),
 (D(11,24), C, "Poll: SEO ya Google Ads, aap kaunsa pehle sikhna chahenge?", "Options: SEO / Google Ads / Social Media / AI Tools. Natija agle video ka topic banega."),
 (D(11,25), S, "3 free SEO tools jo har beginner ko aane chahiye", "Google Search Console, Ahrefs Webmaster Tools, Screaming Frog (free version). Har tool 8-10 sec."),
 (D(11,26), C, "Poster: SEO ke 5 basic steps", "Keyword, title, content, links, speed. 1 image, neeche caption."),
 (D(11,27), S, "Digital Marketer ki salary kitni hoti hai?", "Fresher se experienced tak ka andaza batayein. Koi number likhne se pehle source dekh lein."),
 (D(11,28), L, "SEO Kaise Sikhein? Beginner Roadmap 2027 (Hindi)", "Outline: SEO kya hai, keyword research, on-page, off-page, technical, free tools, practice kaise karein."),
 (D(11,28), C, "Video link post: SEO Roadmap", "Thumbnail + 1 line + sawal 'SEO mein sabse mushkil kya lagta hai?'."),
 (D(11,29), S, "SEO Roadmap video ka best clip", "Long video ka sabse kaam ka 30-45 sec ka hissa. End: 'Poora video channel par'."),
 (D(11,29), C, "Classroom / trainer ki photo ya demo class update", "Asli photo. 2 line caption aur agli demo class ki date."),
 # week 2
 (D(11,30), S, "Google Ads par kitna paisa lagta hai?", "Hook: 'Ad chalane ke liye lakh rupaye nahi chahiye.' Budget ka simple example."),
 (D(12,1), C, "Poll: Aap kis platform par business badhana chahte hain?", "Options: Instagram / Facebook / Google / YouTube."),
 (D(12,2), S, "Instagram reel viral kaise hoti hai? 3 tips", "Pehle 3 second ka hook, chhota video, trending audio ya clear topic."),
 (D(12,3), C, "Poster: Google Ads vs Facebook Ads, fark", "2 column table image. Kab kaunsa use karein."),
 (D(12,4), S, "HSIM student ka project / pehli kamai", "Student ki permission lekar. 20 sec ka feedback ya project dikhayein."),
 (D(12,5), L, "Google Ads Kaise Chalayein? Beginner Tutorial (Hindi)", "Outline: account banana, campaign type, keywords, budget, ad likhna, result padhna. Screen recording."),
 (D(12,5), C, "Video link post: Google Ads Tutorial", "Thumbnail + 1 line + sawal 'Aapka pehla ad kab chalaya?'."),
 (D(12,6), S, "Google Ads video ka best clip", "Long video ka 30-45 sec ka hissa."),
 (D(12,6), C, "Student ya classroom ki photo", "Asli photo ya student ka feedback (permission ke saath)."),
 # week 3
 (D(12,7), S, "Fresher digital marketer ko kaunse skills aane chahiye?", "4 skills: SEO, ads, content, analytics. Har skill 5-6 sec."),
 (D(12,8), C, "Poll: Job chahiye ya freelancing?", "Options: Job / Freelancing / Apna business / Abhi soch raha hoon."),
 (D(12,9), S, "Freelancing mein pehla client kaise milega?", "3 tareeke: apne jaan-pehchaan wale, local business, social media par kaam dikhana."),
 (D(12,10), C, "Poster: Digital marketing ki 5 job roles", "SEO executive, ads specialist, social media manager, content writer, analyst. 1 image."),
 (D(12,11), S, "Interview mein pooche jaane wale 3 SEO sawal", "Sawal bolein, jawab 1 line mein. Hook: 'Interview mein ye zaroor poochha jata hai.'"),
 (D(12,12), L, "Digital Marketing Career 2027: Salary, Jobs aur Freelancing", "Outline: kaunse roles, skills, fresher ke liye shuruaat, freelancing, HSIM ka course. Salary ke number source dekh kar likhein."),
 (D(12,12), C, "Video link post: Digital Marketing Career", "Thumbnail + 1 line + sawal 'Job ya freelancing, aap kya chunenge?'."),
 (D(12,13), S, "Career video ka best clip", "Long video ka 30-45 sec ka hissa."),
 (D(12,13), C, "Student result / certificate + admission reminder", "Certificate ya result ki image (permission ke saath). Neeche naye batch ki date aur WhatsApp."),
 # week 4 (partial)
 (D(12,14), S, "ChatGPT se ad copy kaise likhein?", "Ek asli prompt screen par dikhayein aur uska result."),
 (D(12,15), C, "Poll: Kaunsa AI tool use karte ho?", "Options: ChatGPT / Gemini / Canva AI / koi nahi."),
 (D(12,16), S, "AI se reel script 1 minute mein", "Prompt likhein, script dikhayein, 1 reel ka example."),
 (D(12,17), C, "Poster: Digital marketers ke liye 5 AI tools", "1 image, 5 tools ke naam aur ek line mein kaam."),
]

FONT = "Arial"; thin = Side(style="thin", color="BBBBBB"); border = Border(left=thin, right=thin, top=thin, bottom=thin)
hdr = PatternFill("solid", fgColor="0A46AF"); yel = PatternFill("solid", fgColor="FFFF00")
fill = {S: PatternFill("solid", fgColor="FBD5E2"), L: PatternFill("solid", fgColor="CFE0FA"), C: PatternFill("solid", fgColor="D9F2D9")}
def head(ws, r, vals, widths=None):
    for j, v in enumerate(vals, 1):
        c = ws.cell(r, j, v); c.font = Font(name=FONT, bold=True, color="FFFFFF"); c.fill = hdr; c.border = border
        c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
    if widths:
        for j, w in enumerate(widths, 1): ws.column_dimensions[get_column_letter(j)].width = w
def title(ws, text, sub=None):
    ws["A1"] = text; ws["A1"].font = Font(name=FONT, size=15, bold=True, color="0A46AF")
    if sub: ws["A2"] = sub; ws["A2"].font = Font(name=FONT, size=10, color="555555")

wb = Workbook(); ws = wb.active; ws.title = "30 Day Calendar"
title(ws, "HSIM YouTube Calendar: 18 Nov se 17 Dec 2026 (30 din)",
      "Peele (yellow) columns aap bharein. Example: Status = Posted, Link = https://youtube.com/shorts/abc123, Views/Likes = 1200 views, 45 likes.")
head(ws, 4, ["Date", "Din", "Time (IST)", "Format", "Topic / Title", "Kya karna hai (hook / caption / outline)", "Status", "Link (aap bharein)", "Views / Likes (aap bharein)"],
     [13, 12, 11, 14, 52, 70, 14, 30, 22])
ws.row_dimensions[4].height = 32
FIRST = 5
for i, (d, fmt, ttl, det) in enumerate(rows):
    r = FIRST + i
    tm = "5:30 PM" if ttl.startswith("Video link post") else T[fmt]
    vals = [d, DAYS[d.weekday()], tm, fmt, ttl, det, "Baaki", None, None]
    for j, v in enumerate(vals, 1):
        c = ws.cell(r, j, v); c.font = Font(name=FONT); c.border = border; c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.cell(r, 1).number_format = "dd mmm yyyy"
    ws.cell(r, 4).fill = fill[fmt]; ws.cell(r, 4).font = Font(name=FONT, bold=True)
    for j in (7, 8, 9): ws.cell(r, j).fill = yel
    ws.row_dimensions[r].height = 46
LAST = FIRST + len(rows) - 1
dv = DataValidation(type="list", formula1='"Baaki,Ban raha hai,Posted"', allow_blank=False); ws.add_data_validation(dv); dv.add(f"G{FIRST}:G{LAST+40}")
ws.conditional_formatting.add(f"G{FIRST}:G{LAST+40}", CellIsRule(operator="equal", formula=['"Posted"'], fill=PatternFill("solid", bgColor="B7E1B7", fgColor="B7E1B7")))
ws.freeze_panes = "A5"
ws.cell(LAST + 2, 1, "Agla: Shanivar 19 Dec ko Long video 'Digital Marketing mein AI Tools ka use (Hindi)'.").font = Font(name=FONT, italic=True)

# Weekly targets
wt = wb.create_sheet("Weekly Targets")
title(wt, "Haftay ke targets aur ab tak kitna hua", "Targets (neele) input hain. 'Posted' calendar ke Status column se apne aap ginta hai.")
head(wt, 4, ["Hafta", "Shuru", "Khatam", "Short target", "Short posted", "Long target", "Long posted", "Community target", "Community posted", "Kul target", "Kul posted", "Poora hua %"],
     [26, 13, 13, 13, 13, 13, 13, 16, 16, 12, 12, 14])
wt.row_dimensions[4].height = 32
weeks = [("Launch (18-22 Nov)", D(11,18), D(11,22), 3, 1, 3), ("Hafta 1 (23-29 Nov)", D(11,23), D(11,29), 4, 1, 4),
         ("Hafta 2 (30 Nov-6 Dec)", D(11,30), D(12,6), 4, 1, 4), ("Hafta 3 (7-13 Dec)", D(12,7), D(12,13), 4, 1, 4),
         ("Hafta 4 (14-17 Dec, adha)", D(12,14), D(12,17), 2, 0, 2)]
CAL = "'30 Day Calendar'"
rng = lambda col: f"{CAL}!${col}${FIRST}:${col}${LAST+40}"
for i, (nm, a, b, s, l, c_) in enumerate(weeks):
    r = 5 + i
    cnt = lambda fmt: f'=COUNTIFS({rng("D")},"{fmt}",{rng("G")},"Posted",{rng("A")},">="&$B{r},{rng("A")},"<="&$C{r})'
    vals = [nm, a, b, s, cnt(S), l, cnt(L), c_, cnt(C), f"=D{r}+F{r}+H{r}", f"=E{r}+G{r}+I{r}", f"=IF(J{r}=0,0,K{r}/J{r})"]
    for j, v in enumerate(vals, 1):
        x = wt.cell(r, j, v); x.font = Font(name=FONT, color="0000FF" if j in (4, 6, 8) else "000000"); x.border = border
        x.alignment = Alignment(horizontal="center" if j > 1 else "left")
    wt.cell(r, 2).number_format = "dd mmm yyyy"; wt.cell(r, 3).number_format = "dd mmm yyyy"; wt.cell(r, 12).number_format = "0%"
tr = 5 + len(weeks)
wt.cell(tr, 1, "Kul (30 din)")
for j in range(4, 12): wt.cell(tr, j, f"=SUM({get_column_letter(j)}5:{get_column_letter(j)}{tr-1})")
wt.cell(tr, 12, f"=IF(J{tr}=0,0,K{tr}/J{tr})"); wt.cell(tr, 12).number_format = "0%"
for j in range(1, 13):
    x = wt.cell(tr, j); x.font = Font(name=FONT, bold=True); x.border = border; x.alignment = Alignment(horizontal="center" if j > 1 else "left")
wt.cell(tr + 2, 1, "Source: targets HSIM YouTube Calendar PDF ke plan se (haftay mein 4 Shorts, 1 Long video, 4 Community post; launch aur aakhri hafta adhe).").font = Font(name=FONT, italic=True, size=9)

# Community ideas
cm = wb.create_sheet("Community Post Ideas")
title(cm, "Community mein kya-kya daalna hai")
head(cm, 3, ["Post type", "Kya likhein / dikhayein", "Example caption", "Kitni baar"], [26, 60, 60, 20])
ideas = [
 ("Poll", "Chhota sawal aur 3-4 options. Audience kya seekhna chahti hai, pata chalta hai.", "Aap pehle kya seekhna chahenge? SEO / Google Ads / Social Media / AI Tools", "Haftay mein 1-2"),
 ("Tip poster (image)", "Ek image par ek tip, HSIM logo aur neeche 2-4 line caption.", "SEO ke 5 basic steps. Poora video channel par dekhein.", "Haftay mein 1"),
 ("Video link post", "Naye video ka thumbnail, 1 line aur sawal.", "Naya video aa gaya! Aapka sawal comment mein likhein, hum jawab denge.", "Har long video par"),
 ("Student proof", "Student ka project, certificate, result ya feedback (permission ke saath).", "HSIM ke student ne pehla client banaya. Aapki baari kab?", "Haftay mein 1"),
 ("Classroom / behind the scenes", "Class ki photo, trainer, lab ya live session.", "Aaj ki class mein Google Ads ka practical hua.", "Haftay mein 1"),
 ("Admission / demo class", "Batch ki date, demo class, fees ya offer aur WhatsApp link.", "Free demo class Ravivar ko. Seat ke liye WhatsApp karein: [number]", "Haftay mein 1"),
 ("Festival wish", "Tyohaar par chhoti wish image (date pehle check kar lein).", "HSIM ki taraf se aapko tyohaar ki shubhkamnayein.", "Tyohaar par"),
]
for i, row in enumerate(ideas, start=4):
    for j, v in enumerate(row, 1):
        x = cm.cell(i, j, v); x.font = Font(name=FONT, bold=(j == 1)); x.border = border; x.alignment = Alignment(wrap_text=True, vertical="top")
    cm.row_dimensions[i].height = 44

# Rules
ru = wb.create_sheet("Rules aur Checklist")
title(ru, "Har video ke liye rules aur Ravivar ka 10 minute ka check")
head(ru, 3, ["Cheez", "Kya karein"], [26, 110])
rules = [
 ("Shorts", "Pehle 3 second mein sawal ya hook. Kul 20-45 second. Ek hi baat. Aakhir mein 'Poora video HSIM channel par'."),
 ("Long video title", "Wo likhein jo log search karte hain, jaise 'SEO kaise sikhein', 'Google Ads kaise chalayein'. Aakhir mein '| HSIM'."),
 ("Thumbnail", "Trainer ka chehra, 3-4 bade shabd aur ek hi colour theme (HSIM ka neela aur pink)."),
 ("Description", "Pehli 2 line mein course link ya WhatsApp number, phir chapters, phir @hsim.chandigarh."),
 ("Pinned comment", "'Free demo class ke liye WhatsApp karein: [number]'."),
 ("Comments", "Pehle 1 ghante mein har comment ka jawab dein."),
 ("Playlists", "SEO, Google Ads, Social Media, AI Tools, Career, Student Results, Demo Classes."),
 ("End screen aur cards", "Har long video par agla video aur playlist jodein."),
 ("Ravivar check 1", "Kaunsa Short sabse zyada dekha gaya? Waise hi topic aur banayein."),
 ("Ravivar check 2", "Long video ka average view duration kam ho to intro chhota karein."),
 ("Ravivar check 3", "Is hafta naye subscribers kitne aaye, aur kaunsa video laya."),
 ("Ravivar check 4", "Community poll ke jawab agle video ka topic banayein."),
 ("Ravivar check 5", "Website ya WhatsApp par kitne enquiry aaye. Asli goal admission hai."),
 ("Dhyan rakhein", "[Shehar] ki jagah apna shehar likhein (Chandigarh ya Karnal). Time (6 PM) andaza hai, 2 hafte baad Analytics se badlein. Views ya subscribers ki koi guarantee nahi."),
]
for i, (a, b) in enumerate(rules, start=4):
    for j, v in enumerate((a, b), 1):
        x = ru.cell(i, j, v); x.font = Font(name=FONT, bold=(j == 1)); x.border = border; x.alignment = Alignment(wrap_text=True, vertical="top")
    ru.row_dimensions[i].height = 32
wb.save("HSIM_30_Day_YouTube_Calendar.xlsx"); print("saved", len(rows), "rows; last row", LAST)
