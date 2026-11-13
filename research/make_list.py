from urllib.parse import quote_plus
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

SRC_OK = "Search se confirm"
SRC_KN = "Meri jaankari - verify karein"

def yt(q): return "https://www.youtube.com/results?search_query=" + quote_plus(q)

# name, type/focus, language, what they teach, lesson for HSIM, search query, source
SEO_TOOLS = [
 ("Semrush","SEO + PPC tool brand","English","Keyword research, site audit, competitor analysis, tool tutorials","Har tool tutorial ko Hindi mein samjhakar HSIM ke SEO videos banayein","Semrush",SRC_KN),
 ("Ahrefs","SEO tool brand","English","Course-style SEO tutorials, link building, YouTube SEO","Search-term wale titles aur lambe tutorial format seekhein","Ahrefs",SRC_OK),
 ("Moz","SEO tool brand","English","Whiteboard Friday, local SEO, SEO basics","Ek topic, ek whiteboard, 5 minute - simple format","Moz SEO",SRC_KN),
 ("Backlinko (Brian Dean)","SEO education","English","Link building, SEO strategy case studies","Case-study style titles (jaise '0 se 10K visitors')","Backlinko",SRC_OK),
 ("Neil Patel","SEO + marketing","English","SEO aur marketing tips, daily upload","Volume + consistency ka example","Neil Patel",SRC_KN),
 ("Search Engine Journal","SEO news","English","Google updates, SEO news, webinars","Google update aane par Hindi mein turant explain karein","Search Engine Journal",SRC_KN),
 ("Yoast","SEO plugin brand","English","WordPress SEO, on-page SEO","WordPress/blog SEO ke practical videos","Yoast SEO",SRC_KN),
 ("Surfer SEO","SEO tool brand","English","Content SEO, AI writing aur optimisation","AI + SEO combined videos","Surfer SEO",SRC_KN),
 ("Screaming Frog","SEO tool brand","English","Technical SEO audits","Technical SEO ke liye student-friendly walkthrough","Screaming Frog SEO",SRC_KN),
 ("Google Search Central","Official Google","English","Google ka official SEO guidance","Official source ke hawale se video, trust badhta hai","Google Search Central",SRC_KN),
]
SEO_CREATORS = [
 ("Amit Tiwari","SEO educator (India)","Hindi","Local SEO, Google Business Profile, monthly Google update recap","Monthly 'Google update' video ka format apnayein","Amit Tiwari SEO",SRC_OK),
 ("Umar Tazkeer","SEO educator (India)","Hindi","Free SEO + digital marketing full courses","Free full-course playlist se subscribers aate hain","Umar Tazkeer",SRC_OK),
 ("Amit Mishra (Tryootech)","Blogging / SEO (India)","Hindi","Blogging, SEO, affiliate aur AI tools","SEO + AI tools ka mix","Tryootech Amit Mishra",SRC_OK),
 ("Master Blogger (Amit Singla)","Blogging / SEO (India)","Hindi","Blogging aur SEO","Blog se kamai ka angle","Master Blogger Amit Singla",SRC_OK),
 ("WsCube Tech","Institute + channel (India)","Hindi","Poora SEO course, digital marketing","Sabse seedha competitor - unke topics aur playlists dekhein","WsCube Tech SEO",SRC_OK),
 ("My Vyas","SEO educator (India)","Hindi","On-page aur off-page SEO","On-page/off-page checklist videos","My Vyas SEO",SRC_OK),
 ("Kunjal Chawhan","SEO case studies (India)","English/Hinglish","Apne blog par test karke case study","Real experiment + result dikhane ka format","Kunjal Chawhan",SRC_OK),
 ("Satish Kushwaha (Satish K Videos)","SEO / blogging (India)","Hindi","SEO, blogging, affiliate, YouTube growth","Beginner-friendly Hindi explain style","Satish K Videos",SRC_OK),
 ("Digital Deepak (Deepak Kanakaraju)","Digital marketing pioneer (India)","English","Digital marketing education, career guidance","Career aur salary wale topics","Digital Deepak",SRC_OK),
 ("Alok Badatia","Digital marketing (India)","Hindi","Digital marketing aur agency case studies","Agency ke asli projects dikhana","Alok Badatia",SRC_OK),
]
SMM = [
 ("Manoj Dey","YouTube growth (India)","Hindi","YouTube growth tutorials, beginners ke liye","Channel growth ke tips aur titling ka tarika","Manoj Dey",SRC_OK),
 ("Marketing Fundas","SMM educator (India)","Hindi","Organic aur paid marketing ka poora course","Full-course playlist model","Marketing Fundas",SRC_OK),
 ("Anurag Bansal","Marketing educator (India)","English/Hinglish","Marketing strategy aur case studies","Brand case-study videos","Anurag Bansal marketing",SRC_OK),
 ("Damini Tripathi","Digital marketing (India)","Hindi/English","Digital marketing (co-founder Wincible)","Women-friendly career angle","Damini Tripathi",SRC_OK),
 ("Mr Mradul","Freelance marketing (India)","Hindi","Freelancing aur marketing","Freelancing se kamai ka angle (students ke liye)","Mr Mradul",SRC_OK),
 ("Pr Prakash","Ecommerce + digital marketing (India)","Hindi","Ecommerce aur digital marketing","Ecommerce ke case studies","Pr Prakash",SRC_OK),
 ("Raj Shamani","Content strategy (India)","Hindi","Instagram growth aur content strategy","Podcast + reels ka mix","Raj Shamani",SRC_OK),
 ("Vaibhav Sisinty","Growth marketing + AI (India)","English/Hinglish","Marketing aur AI-tool breakdowns, reels mein","Chhoti reels mein actionable tips","Vaibhav Sisinty",SRC_OK),
 ("Sorav Jain","Digital marketing (India)","English/Hinglish","Digital marketing (Echo Digital)","Industry trends par commentary","Sorav Jain",SRC_OK),
 ("Ankur Warikoo","Personal brand (India)","Hinglish","Personal brand, content, business","Personal storytelling se trust banana","Ankur Warikoo",SRC_KN),
]
INST = [
 ("Digital Vidya","Digital marketing institute","English/Hinglish","Online + weekend programs, DMI certification","Certification aur placement ka proof dikhana","Digital Vidya",SRC_OK),
 ("IIDE","Digital marketing institute","English/Hinglish","Digital marketing programs, placement support","Student placement stories","IIDE Indian Institute of Digital Education",SRC_OK),
 ("upGrad","Online education","English/Hinglish","Digital marketing certification (university collab)","Working professionals ke liye content","upGrad digital marketing",SRC_OK),
 ("WsCube Tech","Institute + YouTube","Hindi","SEO, YouTube marketing, Google Ads, free courses","Sabse bada Hindi competitor","WsCube Tech digital marketing",SRC_OK),
 ("DIDM (Delhi Institute of Digital Marketing)","Digital marketing institute (Delhi)","Hindi/English","Advanced digital marketing courses","Offline classroom promotion ka tarika","DIDM Delhi Institute of Digital Marketing",SRC_OK),
 ("Kraftshala","Marketing education","English","Online digital marketing courses","Brand-style courses ka positioning","Kraftshala",SRC_OK),
 ("PW Skills","Online education","Hindi","Digital marketing courses","Low-fee, Hindi positioning","PW Skills digital marketing",SRC_OK),
 ("Digital Gurukul","Institute (Delhi)","Hindi","Digital marketing training","Chhote institute ka local marketing","Digital Gurukul digital marketing",SRC_OK),
 ("Simplilearn","Online education","English","Digital marketing certification","Course demo aur webinar format","Simplilearn digital marketing",SRC_KN),
 ("Digital Deepak Internet Business School","Training (India)","English","Digital marketing training programs","Mentor-led training ka brand","Digital Deepak training",SRC_OK),
]
AI = [
 ("Ajeet AI","AI tools (India)","Hindi","AI tools aur tutorials, saral Hindi mein","Har naya AI tool 5 minute mein explain","Ajeet AI",SRC_OK),
 ("Ankit Arora","AI for creators (India)","Hindi","Content creators ke liye AI tools","Creators ke liye AI workflows","Ankit Arora AI tools",SRC_OK),
 ("Abhi Rathore","YouTube + AI (India)","Hindi","YouTube growth, SEO aur AI tools","Small creators ke liye AI + SEO","Abhi Rathore",SRC_OK),
 ("Sorav Jain","AI for marketing (India)","English/Hinglish","Marketing ke liye AI tools","Marketing + AI trends","Sorav Jain AI",SRC_OK),
 ("Varun Mayya","AI + business (India)","Hindi/English","AI, business aur tech","Business angle ke saath AI","Varun Mayya",SRC_OK),
 ("Krish Naik","AI / ML (India)","English/Hinglish","Generative AI ke hands-on projects","Project-based teaching","Krish Naik",SRC_OK),
 ("Sunny Savita","Generative AI (India)","Hindi","Beginners ke liye Generative AI playlist","Beginner playlist model","Sunny Savita",SRC_OK),
 ("CodeWithHarry","Coding + AI (India)","Hindi","Beginner-friendly AI/coding","Hindi mein simple teaching style","CodeWithHarry",SRC_OK),
 ("Technical Guruji","Tech + AI reviews (India)","Hindi","AI tools aur tech reviews","Review + demo format","Technical Guruji",SRC_OK),
 ("Trakin Tech","Tech reviews (India)","Hindi","Naye AI tools ke reviews","Tool review format","Trakin Tech",SRC_OK),
]

SHEETS = [
 ("1 SEO Tools & Brands", "SEO ke global brands/tools (Semrush, Ahrefs, Moz jaise)", SEO_TOOLS),
 ("2 SEO Creators (India)", "SEO sikhane wale Indian creators", SEO_CREATORS),
 ("3 SMM-SMO Creators (India)", "Social Media Marketing / Optimisation sikhane wale Indian creators", SMM),
 ("4 DM Institutes", "Digital Marketing institutes / competitors", INST),
 ("5 AI Creators (India)", "AI tools sikhane wale Indian creators", AI),
]

FONT = "Arial"
thin = Side(style="thin", color="BBBBBB")
border = Border(left=thin, right=thin, top=thin, bottom=thin)
hdr_fill = PatternFill("solid", fgColor="0A46AF")
yel = PatternFill("solid", fgColor="FFFF00")
alt = PatternFill("solid", fgColor="EEF3FB")

wb = Workbook()
ws = wb.active; ws.title = "Summary"
ws["A1"] = "HSIM - Competitor aur Creator Research List"; ws["A1"].font = Font(name=FONT, size=16, bold=True, color="0A46AF")
rows = [
 ("Date", "13 November 2026"),
 ("Purpose", "HSIM YouTube channel (@hsim.official) ko grow karne ke liye seekhne layak channels aur brands."),
 ("Sheets", "5 sheets, har ek mein 10 entries: SEO Tools & Brands, SEO Creators (India), SMM-SMO Creators (India), DM Institutes, AI Creators (India)."),
 ("Link column", "Link YouTube search page kholta hai. Ye bina exact handle ke bhi sahi channel tak pahunchata hai."),
 ("Source column", "'Search se confirm' = web search mein mila. 'Meri jaankari - verify karein' = search mein nahi mila, channel YouTube par ek baar check kar lein."),
 ("Yellow columns", "Peele (yellow) columns aap khud bharein: subscribers, last upload date, notes."),
 ("Example (yellow)", "Subscribers: 120K | Last upload: 10 Nov 2026 | Notes: Weekly Hindi SEO tutorial, thumbnail mein chehra + 3 shabd"),
 ("Note", "Subscriber numbers jaan-boojh kar nahi diye, kyunki alag sites alag batati hain aur wo badalte rehte hain."),
 ("HSIM abhi", "594 subscribers (public page ke hisaab se)."),
]
for i, (k, v) in enumerate(rows, start=3):
    ws.cell(i, 1, k).font = Font(name=FONT, bold=True)
    c = ws.cell(i, 2, v); c.font = Font(name=FONT); c.alignment = Alignment(wrap_text=True, vertical="top")
    if k.startswith("Example"): c.fill = yel
ws.column_dimensions["A"].width = 18; ws.column_dimensions["B"].width = 110
for i in range(3, 3 + len(rows)): ws.row_dimensions[i].height = 30

headers = ["#", "Naam", "Type", "Bhasha", "Kya sikhate / karte hain", "HSIM ke liye seekh", "YouTube link", "Source status", "Subscribers (aap bharein)", "Last upload (aap bharein)", "Notes (aap bharein)"]
widths = [5, 32, 28, 16, 50, 50, 16, 26, 22, 22, 36]
for title, sub, data in SHEETS:
    s = wb.create_sheet(title)
    s["A1"] = sub; s["A1"].font = Font(name=FONT, size=13, bold=True, color="0A46AF")
    for j, h in enumerate(headers, start=1):
        c = s.cell(3, j, h); c.font = Font(name=FONT, bold=True, color="FFFFFF"); c.fill = hdr_fill
        c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center"); c.border = border
    for i, (name, typ, lang, teach, lesson, q, src) in enumerate(data, start=1):
        r = 3 + i
        vals = [i, name, typ, lang, teach, lesson, None, src, None, None, None]
        for j, v in enumerate(vals, start=1):
            c = s.cell(r, j, v); c.font = Font(name=FONT); c.border = border
            c.alignment = Alignment(wrap_text=True, vertical="top")
            if i % 2 == 0: c.fill = alt
        lc = s.cell(r, 7, "Open on YouTube"); lc.hyperlink = yt(q); lc.font = Font(name=FONT, color="0563C1", underline="single")
        if src == SRC_KN: s.cell(r, 8).font = Font(name=FONT, color="C00000")
        for j in (9, 10, 11): s.cell(r, j).fill = yel
        s.row_dimensions[r].height = 48
    for j, w in enumerate(widths, start=1): s.column_dimensions[get_column_letter(j)].width = w
    s.row_dimensions[3].height = 34
    s.freeze_panes = "C4"
wb.save("/home/user/hsim-internship/HSIM_Competitor_Creator_List.xlsx")
print("saved")
