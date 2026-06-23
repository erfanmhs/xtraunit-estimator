#!/usr/bin/env python3
"""Generate the XtraUnit Estimator architecture + full DB-schema diagrams
(SVG, flat light theme) and a 2-page PDF. Pure-python (svglib + reportlab)."""
import os, html

OUT = os.path.join(os.path.dirname(__file__), "..", "docs")
os.makedirs(OUT, exist_ok=True)

# ---- palette (flat light, hardcoded so it converts to PDF cleanly) ----
INK = "#0f172a"; SUB = "#64748b"; LINE = "#cbd5e1"; SOFT = "#e2e8f0"
HEADBG = "#eef2f7"; CARD = "#ffffff"; ROW = "#f8fafc"
RED = "#A01C2D"; BLUE = "#2563eb"; BANDBG = "#f1f5f9"

def e(s): return html.escape(str(s), quote=True)

def rect(x,y,w,h,fill=CARD,stroke=LINE,rx=8,sw=1):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'
def txt(x,y,s,size=12,fill=INK,anchor="start",weight="normal",mono=False):
    fam = "Courier, monospace" if mono else "Helvetica, Arial, sans-serif"
    return (f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" '
            f'fill="{fill}" text-anchor="{anchor}" font-weight="{weight}">{e(s)}</text>')
def tri(cx,cy,d=5,fill=SUB):  # right-pointing arrowhead
    return f'<path d="M{cx-d},{cy-d} L{cx+d},{cy} L{cx-d},{cy+d} Z" fill="{fill}"/>'

# ============================================================ PAGE 1: ARCH
def page_architecture():
    W,H = 1180, 760
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">',
         rect(0,0,W,H,fill="#ffffff",stroke="#ffffff",rx=0)]
    s.append(txt(40,44,"XtraUnit Estimator — Architecture & Data Flow",24,INK,weight="bold"))
    s.append(txt(40,68,"Next.js 16 (App Router) · React 19 · Supabase (Postgres + RLS) · Anthropic Claude · pdf.js / pdf-lib · Render",11.5,SUB,mono=True))

    # pipeline
    s.append(txt(40,104,"1 · PRODUCT PIPELINE  (plans -> proposal)",12.5,RED,weight="bold"))
    stages=[("Plans","upload & trim PDF"),("Prepare","extract sheet text"),("Takeoff","measure on SVG"),
            ("AI Scope","draft + review"),("Pricing","history + AI"),("Estimate","markups -> total"),("Proposal","letter + PDF")]
    cw,gap=148,12
    for i,(t,sub) in enumerate(stages):
        x=40+i*(cw+gap)
        s.append(rect(x,116,cw,46,fill=CARD))
        s.append(txt(x+cw/2,138,t,13,INK,anchor="middle",weight="bold"))
        s.append(txt(x+cw/2,154,sub,10.5,SUB,anchor="middle"))
        if i<len(stages)-1: s.append(tri(x+cw+gap/2,139,4))

    # stack
    s.append(txt(40,196,"2 · ARCHITECTURE  (a request flows top -> bottom; data returns bottom -> top)",12.5,RED,weight="bold"))
    bands=[("Browser","React client", ["PDF.js page render","SVG measure overlay","pdf-lib trim / export","undo/redo · optimistic UI"]),
           ("Next.js 16","@ Render · 1 inst", ["Server Components (read)","Server Actions (write)","Background AI jobs","config/ai.ts model map"]),
           ("Supabase","backend", ["Auth (email)","Postgres + Row-Level Security","Storage — plans bucket"]),
           ("Claude","Anthropic API", ["Opus 4.8 — draft/price","Sonnet 4.6 — review/letter","Files API (plan vision)","structured JSON output"])]
    by=206; bh=78; bgap=18
    labels=["server actions · RSC","SQL + Storage · RLS","AI calls + Files API"]
    for bi,(name,tech,subs) in enumerate(bands):
        y=by+bi*(bh+bgap)
        s.append(rect(40,y,1108,bh,fill=BANDBG,stroke=SOFT))
        s.append(rect(40,y,5,bh,fill=RED,stroke=RED,rx=0))
        s.append(txt(60,y+30,name,15,INK,weight="bold"))
        s.append(txt(60,y+50,tech,10,SUB,mono=True))
        n=len(subs); sw=(1108-200-12*(n))/n
        for ci,sub in enumerate(subs):
            sx=230+ci*(sw+12)
            s.append(rect(sx,y+22,sw,34,fill=CARD,stroke=LINE,rx=7))
            s.append(txt(sx+sw/2,y+43,sub,11,INK,anchor="middle"))
        if bi<len(bands)-1:
            ay=y+bh+bgap/2
            s.append(f'<line x1="150" y1="{y+bh+2}" x2="150" y2="{y+bh+bgap-2}" stroke="{SUB}" stroke-width="1"/>')
            s.append(tri(150,y+bh+bgap-2,3,SUB))
            s.append(txt(162,ay+3,labels[bi],10,SUB,mono=True))

    # job pattern note
    ny=by+4*(bh+bgap)+2
    s.append(rect(40,ny,1108,84,fill=CARD,stroke=LINE))
    s.append(txt(58,ny+24,"Signature pattern — background AI jobs (scope & pricing)",13.5,INK,weight="bold"))
    s.append(txt(58,ny+46,"Server Action inserts a scope_runs row -> spawns a fire-and-forget job in the SAME process -> job re-auths with the user's token ->",11,SUB))
    s.append(txt(58,ny+63,"gatherBundle -> Files API (streamed 1 file/time) -> draftScope (Opus, chunked) -> findGaps (Sonnet) -> writes line_items + scope_findings; UI polls progress.",11,SUB))
    s.append(txt(1130,ny+24,"Known limit: single instance — a job queue + worker is the next infra step.",10,RED,anchor="end",mono=True))
    s.append(txt(40,H-18,"Deploy:  git push main  ->  Render auto-deploys     ·     one Supabase project backs both local & production",11,SUB,mono=True))
    s.append("</svg>")
    return "\n".join(s), W, H

# ============================================================ PAGE 2: SCHEMA
# (col, type, key)  key: 'pk' | 'fk:Target' | 'u' | ''
SCHEMA = {
 "projects":[("id","uuid","pk"),("owner_id","uuid","fk:auth.users"),("name","text",""),("client_name","text",""),
   ("address","text",""),("project_type","text",""),("status","text",""),("notes","text",""),("region","text",""),
   ("created_at","timestamptz",""),("updated_at","timestamptz","")],
 "plan_files":[("id","uuid","pk"),("project_id","uuid","fk:projects"),("owner_id","uuid","fk:auth.users"),
   ("file_name","text",""),("storage_path","text",""),("size_bytes","bigint",""),("mime_type","text",""),("created_at","timestamptz","")],
 "sheets":[("id","uuid","pk"),("project_id","uuid","fk:projects"),("plan_file_id","uuid","fk:plan_files"),
   ("owner_id","uuid","fk:auth.users"),("page_number","int",""),("original_page_number","int",""),("name","text",""),
   ("label","text",""),("notes","text",""),("scale_px_per_unit","numeric",""),("scale_unit","text",""),("scale_x","numeric",""),
   ("scale_y","numeric",""),("scale_preset","text",""),("extracted_text","text",""),("ingest_method","text",""),
   ("ingested_at","timestamptz",""),("ledger","jsonb",""),("created_at","timestamptz","")],
 "profiles":[("id","uuid","pk → auth.users"),("email","text",""),("full_name","text",""),("role","text",""),("created_at","timestamptz","")],
 "measurements":[("id","uuid","pk"),("project_id","uuid","fk:projects"),("plan_file_id","uuid","fk:plan_files"),
   ("sheet_id","uuid","fk:sheets"),("owner_id","uuid","fk:auth.users"),("type","text",""),("geometry","jsonb",""),("value","numeric",""),
   ("unit","text",""),("layer","text",""),("color","text",""),("attributes","jsonb",""),("wall_sided","text",""),("wall_height","numeric",""),
   ("vol_mode","text",""),("vol_width","numeric",""),("vol_depth","numeric",""),("text","text",""),("font_size","numeric",""),
   ("head_size","numeric",""),("created_at","timestamptz","")],
 "company_settings":[("id","uuid","pk"),("owner_id","uuid","fk:auth.users · uniq"),("company_name","text",""),("company_address","text",""),
   ("company_phone","text",""),("company_email","text",""),("company_license","text",""),("default_contingency_pct","numeric",""),
   ("default_insurance_pct","numeric",""),("default_op_pct","numeric",""),("signer_name","text",""),("signer_title","text",""),
   ("benchmarks","jsonb",""),("unit_prices","jsonb",""),("proposal_profile","jsonb",""),("created_at","timestamptz",""),("updated_at","timestamptz","")],
 "line_items":[("id","uuid","pk"),("project_id","uuid","fk:projects"),("plan_file_id","uuid","fk:plan_files"),("owner_id","uuid","fk:auth.users"),
   ("division_code","text",""),("division_name","text",""),("section_code","text",""),("section_name","text",""),("description","text",""),
   ("quantity","numeric",""),("unit","text",""),("source_kind","text",""),("evidence","jsonb",""),("status","text",""),("confidence","text",""),
   ("ai_generated","bool",""),("user_edited","bool",""),("notes","text",""),("sort_order","int",""),("price_mode","text",""),
   ("cost_labor","numeric",""),("cost_material","numeric",""),("cost_sub","numeric",""),("cost_equipment","numeric",""),("cost_other","numeric",""),
   ("cost_total","numeric",""),("price_source","text",""),("price_note","text",""),("price_confidence","text",""),("price_status","text",""),
   ("priced_at","timestamptz",""),("sub_quote_id","uuid","fk:sub_quotes"),("created_at","timestamptz",""),("updated_at","timestamptz","")],
 "scope_runs":[("id","uuid","pk"),("project_id","uuid","fk:projects"),("owner_id","uuid","fk:auth.users"),("status","text",""),
   ("stage","text",""),("progress","int",""),("error","text",""),("kind","text",""),("created_at","timestamptz",""),("updated_at","timestamptz","")],
 "cost_database":[("id","uuid","pk"),("owner_id","uuid","fk:auth.users"),("project_id","uuid","fk:projects"),("item_id","uuid","fk:cost_items"),
   ("division_code","text",""),("section_code","text",""),("description","text",""),("unit","text",""),("price_mode","text",""),
   ("cost_labor","numeric",""),("cost_material","numeric",""),("cost_sub","numeric",""),("cost_equipment","numeric",""),("cost_other","numeric",""),
   ("cost_total","numeric",""),("price_source","text",""),("price_note","text",""),("price_confidence","text",""),("source","text",""),
   ("region","text",""),("project_type","text",""),("building_sf","numeric",""),("observed_on","date",""),("created_at","timestamptz","")],
 "cost_items":[("id","uuid","pk"),("owner_id","uuid","fk:auth.users"),("division_code","text",""),("section_code","text",""),("name","text",""),
   ("norm_key","text",""),("unit","text",""),("aliases","jsonb",""),("std_cost_override","numeric",""),("std_cost_computed","numeric",""),
   ("std_count","int",""),("last_observed","timestamptz",""),("active","bool",""),("created_at","timestamptz",""),("updated_at","timestamptz","")],
 "scope_findings":[("id","uuid","pk"),("project_id","uuid","fk:projects"),("plan_file_id","uuid","fk:plan_files"),("owner_id","uuid","fk:auth.users"),
   ("kind","text",""),("text","text",""),("severity","text",""),("evidence","jsonb",""),("resolved","bool",""),("answer","text",""),
   ("answered_at","timestamptz",""),("created_at","timestamptz","")],
 "sub_quotes":[("id","uuid","pk"),("project_id","uuid","fk:projects"),("owner_id","uuid","fk:auth.users"),("sub_name","text",""),("trade","text",""),
   ("division_codes","text[]",""),("quote_date","text",""),("total","numeric",""),("file_path","text",""),("file_name","text",""),
   ("extracted","jsonb",""),("notes","text",""),("created_at","timestamptz","")],
 "estimates":[("id","uuid","pk"),("project_id","uuid","fk:projects · uniq"),("owner_id","uuid","fk:auth.users"),("contingency_pct","numeric",""),
   ("insurance_pct","numeric",""),("overhead_pct","numeric",""),("profit_pct","numeric",""),("building_sf","numeric",""),("notes","text",""),
   ("created_at","timestamptz",""),("updated_at","timestamptz","")],
 "proposals":[("id","uuid","pk"),("project_id","uuid","fk:projects · uniq"),("owner_id","uuid","fk:auth.users"),("letter_text","text",""),
   ("client_name","text",""),("proposal_date","text",""),("project_description","text",""),("understanding","text",""),
   ("estimated_duration","text",""),("anticipated_start","text",""),("table_style","text",""),("created_at","timestamptz",""),("updated_at","timestamptz","")],
}
GROUP = {"projects":"core","plan_files":"core","sheets":"core","profiles":"core","measurements":"core",
 "line_items":"scope","scope_findings":"scope","scope_runs":"scope","sub_quotes":"scope","company_settings":"sell",
 "estimates":"sell","proposals":"sell","cost_database":"cost","cost_items":"cost"}
ABBR={"uuid":"uuid","text":"text","numeric":"num","bigint":"int8","int":"int","bool":"bool",
 "timestamptz":"ts","jsonb":"jsonb","date":"date","text[]":"text[]"}

COLS = [
  ["projects","plan_files","sheets","profiles"],
  ["measurements","company_settings"],
  ["line_items","scope_runs"],
  ["cost_database","cost_items"],
  ["scope_findings","sub_quotes","estimates","proposals"],
]

def page_schema():
    colw=252; gapx=16; left=24; top=92
    rowh=13.5; headh=24; tgap=20
    # measure column heights
    def col_height(names):
        h=0
        for n in names: h += headh + len(SCHEMA[n])*rowh + tgap
        return h
    W = left*2 + len(COLS)*colw + (len(COLS)-1)*gapx
    H = top + max(col_height(c) for c in COLS) + 30
    s=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {int(W)} {int(H)}" width="{int(W)}" height="{int(H)}">',
       rect(0,0,W,H,fill="#ffffff",stroke="#ffffff",rx=0)]
    s.append(txt(left,40,"XtraUnit Estimator — Database Schema (Supabase / Postgres)",22,INK,weight="bold"))
    s.append(txt(left,62,"15 tables · every table is owner-scoped via Row-Level Security (owner_id -> auth.users).  •=primary key   ->=foreign key reference   uniq=unique",11,SUB,mono=True))
    for ci,names in enumerate(COLS):
        x=left+ci*(colw+gapx); y=top
        for n in names:
            cols=SCHEMA[n]; bh=headh+len(cols)*rowh
            s.append(rect(x,y,colw,bh,fill=CARD,stroke=LINE,rx=7,sw=1.2))
            s.append(rect(x,y,colw,headh,fill=HEADBG,stroke=LINE,rx=7,sw=1.2))
            s.append(f'<rect x="{x}" y="{y+headh-7}" width="{colw}" height="7" fill="{HEADBG}"/>')
            s.append(txt(x+10,y+16,n,12.5,RED,weight="bold",mono=True))
            ry=y+headh
            for ri,(cn,ct,key) in enumerate(cols):
                if ri%2==1: s.append(f'<rect x="{x+1}" y="{ry}" width="{colw-2}" height="{rowh}" fill="{ROW}"/>')
                ty=ry+rowh-3.5
                pk = key.startswith("pk")
                fk = key.startswith("fk")
                bullet = "• " if pk else ""
                nmcol = RED if pk else INK
                s.append(txt(x+10,ty,bullet+cn,9.5,nmcol,weight=("bold" if pk else "normal"),mono=True))
                if fk:
                    tgt=key.split(":")[1]
                    s.append(txt(x+colw-8,ty,"-> "+tgt,8.5,BLUE,anchor="end",mono=True))
                elif "pk → auth.users" in key:
                    s.append(txt(x+colw-8,ty,"-> auth.users",8.5,BLUE,anchor="end",mono=True))
                else:
                    s.append(txt(x+colw-8,ty,ABBR.get(ct,ct),8.5,SUB,anchor="end",mono=True))
                ry+=rowh
            y+=bh+tgap
    s.append("</svg>")
    return "\n".join(s), W, H

# ---- write SVGs ----
arch_svg, aw, ah = page_architecture()
sch_svg, sw_, sh = page_schema()
with open(os.path.join(OUT,"architecture.svg"),"w",encoding="utf-8") as f: f.write(arch_svg)
with open(os.path.join(OUT,"db-schema.svg"),"w",encoding="utf-8") as f: f.write(sch_svg)
print("wrote SVGs:", int(aw),"x",int(ah)," | ",int(sw_),"x",int(sh))

# ---- render 2-page PDF ----
from svglib.svglib import svg2rlg
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.graphics import renderPDF
d1=svg2rlg(os.path.join(OUT,"architecture.svg"))
d2=svg2rlg(os.path.join(OUT,"db-schema.svg"))
pdf_path=os.path.join(OUT,"xtraunit-estimator-architecture.pdf")
c=pdfcanvas.Canvas(pdf_path)
for d in (d1,d2):
    c.setPageSize((d.width,d.height)); renderPDF.draw(d,c,0,0); c.showPage()
c.save()
print("wrote PDF:", pdf_path, os.path.getsize(pdf_path),"bytes")
