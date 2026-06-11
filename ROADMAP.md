# XtraUnit Estimator — Build Roadmap

A living plan for the whole app. We check items off as we build. Written in
plain language so anyone can follow where we are.

---

## What this app does (in one paragraph)

A signed-in XtraUnit team member starts a **project** (a job to bid) and uploads
the **plan set** (PDF). Inside the app they **view the plans, calibrate scale,
and do the takeoff** — measuring lengths, areas, and counts, and marking up the
drawings. The app turns that into **accurate, structured quantity data**. The AI
engine (Claude) then reads the schedules and notes, organizes everything into
**CSI MasterFormat** divisions, helps **price** each line, applies **markups**,
and produces a **priced estimate** plus a **client-ready proposal**. Everything
is saved, so pricing gets faster every job.

**Strategy (decided 2026-06-05):** this app is a **one-stop shop** — the takeoff
happens *inside the app*, not in Bluebeam/PlanSwift. We store the **original PDF**
(no conversion to TIF); the in-app viewer renders the vector PDF crisply, and all
markups and measurements are saved as **separate, editable data** layered over it.
Build approach: **open-source (PDF.js)**. Target plan size: **medium, 25–80 sheets**.

Two rules that protect XtraUnit's reputation:
1. **Nothing is final until a human approves it.** The AI can read scope AND
   measure/estimate quantities from the calibrated drawings — but every AI
   number is flagged "proposed" and must be checked/approved by a user before
   it counts. Human takeoff and AI takeoff live side by side; the human has the
   final say.
2. **Never invent a price.** Every cost traces to a source with a confidence level.

---

## The four layers

- **Frontend** — what the user sees and clicks (viewer, tools, forms, tables).
- **Backend** — server logic that saves data and runs the rules.
- **Data (Supabase)** — database tables + file storage.
- **AI (Claude)** — reads schedules/notes, organizes scope, drafts text.

---

## Data we need to store (Supabase)

| Table / Store | What it holds |
|---|---|
| `profiles` | Each signed-in user |
| `projects` | A job to bid |
| `plan_files` | Uploaded plan PDFs (file in Storage + a record) ✅ |
| `sheets` | Per-page info: page #, label, **notes (for AI)**, scale (horizontal + vertical) |
| `markups` | Annotations per sheet (boxes, lines, clouds, text) as editable data |
| `measurements` | Takeoff per sheet: type (line/polyline/area/wall/volume/count), geometry, value, unit, layer, color, attributes; wall = sided + height; volume = width + depth (cf/cy) |
| `line_items` | Scope/takeoff lines mapped to CSI division & section |
| `cost_database` | Growing unit prices: material/labor/equipment, source, confidence |
| `estimates` | Assembled priced estimate: subtotals, markups, totals |
| `proposals` | Generated proposal documents |
| `company_settings` | Company profile + default markup rates |

(Exact columns are refined as we build each one.)

---

## Build plan (phases, in order)

### ✅ Phase 0 — Foundation (DONE)
Branded app, Supabase + Claude connected, login/sign-up/forgot-password,
company profile.

### ✅ Phase 1 — App skeleton + projects (DONE)
Sidebar shell, `profiles` + `projects` tables with access rules, Projects
dashboard, New Project form, project workspace.

### ✅ Phase 2 — Get the plans in (DONE)
Upload to a private storage bucket, `plan_files` records, view/delete. The
original **PDF** is the stored master — confirmed correct for the new direction.

### Phase 3 — Page Selection & Triage (on upload)  ✅ DONE (verified live 2026-06-05)
*Goal: keep only the sheets that matter — save storage and AI cost.*
- [x] On dropping a PDF, render page thumbnails locally (PDF.js) — nothing uploaded yet
- [x] Default: every page DROPPED; click the important sheets to KEEP
- [x] Label kept pages (Architectural / Structural / MEP / Schedules / Civil / Other)
- [x] Build a trimmed PDF of only kept pages; upload ONLY that (dropped pages never leave the computer)
- [x] Store per-page labels (`sheets` table); rollback guard so no orphan files
- Verified on the real 14-page "624 W Imperial" set: 14 thumbnails rendered, kept 3 → 1 trimmed file + 3 sheets.

### Phase 4 — Plan Viewer (in-app)  ✅ DONE (verified live 2026-06-05)
*Goal: open and browse the kept plans inside the app.*
- [x] Render PDF pages with PDF.js (downloads private file, renders on demand)
- [x] Sheet navigator with triage labels + zoom (−/+/Fit) & scroll-to-pan
- [x] One page rendered at a time, on demand (fast for medium sets)
- [x] "Open" button on each saved plan in the project's Plans list
- [x] **Mouse-wheel zoom** (toward cursor) + **drag-to-pan** (middle-button anywhere; left-drag in Browse) — *added & verified 2026-06-05*
- Verified: loaded a saved plan, rendered title sheet, switched to Structural sheet, zoom 17%→27%.

### Phase 5 — Scale & Measurement (the in-app takeoff)  ← the core
*Goal: calibrate scale and measure accurately — the structured data the AI needs.*

**Foundation**
- [x] Interactive overlay on the rendered sheet (geometry stored in PDF points, zoom-aware) — *done & verified 2026-06-05*
- [x] Per-sheet **notes box** (auto-saves as you type) — *done & verified 2026-06-05*

**Scale (two modes, per sheet)** — scale is OPTIONAL until you measure
- [x] **Preset scale** — pick from standard arch/structural/civil scales; saved per sheet — *done & verified 2026-06-05*
- [x] **Manual scale** — draw a known dimension, enter feet + axis (H/V); one axis sets both, calibrate both for accuracy — *built 2026-06-05 (UI; uses the proven scale-save path)*

**Measure tools** (each lets you tag attributes — layer name, color, etc. — when selected)
- [x] **Line** (single segment → length) — *done & verified 2026-06-05 (66.7 ft test, math exact)*
- [x] **Polyline** (multi-segment → total length) — *built 2026-06-08; click to add points, double-click / click-last-vertex to finish, live running length; reuses the proven insert + select/edit/duplicate/delete framework. Pending Erfan's live click-test.*
- [x] **Area** (polygon → square footage) — *built 2026-06-08; click corners, close by clicking the first/last vertex or double-click, live sf readout, filled polygon, click-inside to select, area recomputes on vertex edit (shoelace, H/V-scale aware). Pending Erfan's live click-test.*
- [x] **Wall** (length × height → area; choose **single- or double-sided**, enter **wall height**) — *built 2026-06-08; draw the run like a polyline, set height (ft) + single/double in the toolbar; area = length × height × sides (sf), saved to wall_height/wall_sided. Edit height/sides in the right rail (area recomputes); reshape recomputes too. Pending Erfan's live click-test.*
- [x] **Volume** (enter **width + depth** on select → draw runs → linear feet; **Volume = LF × W × D**, shown in cubic feet **and** cubic yards). Plus an **area × depth** variant for slabs/excavation. — *built 2026-06-08; toolbar mode toggle (Linear run / Area × depth) + width (linear) + depth inputs; live cf readout, canvas + panel show cf · cy; edit width/depth in right rail (recomputes), reshape recomputes. **Needs migration 0005_phase5_volume.sql run in Supabase (vol_mode/vol_width/vol_depth).** Pending Erfan's live click-test.*
- [x] **Count** (place markers → count) — *built 2026-06-08; click to drop a marker per item, live tally, "Save count (N)" button; no scale needed; markers render as dots, select/move/duplicate/delete like the rest.*
- [x] Save each as a structured record (type, geometry, value, unit, layer, color, attributes incl. width/depth/height) — *all six tools persist to the `measurements` table.*
- [x] **Select / modify / edit / duplicate / delete** each measurement individually — *done & verified 2026-06-05 (Select tool: click to select, drag handles to reshape, edit layer/color, duplicate, delete)*
- [x] **Interaction polish** (Figma/Photoshop conventions): **Esc** cancels/steps back (draft → calib → tool→Select → deselect), pan via **right-drag (default)** / **Space-drag** / **middle-drag** from any tool (right-click menu suppressed), **Del** = delete selected, mode-aware cursors, on-screen hint — *added & verified 2026-06-05*
- [x] Running totals by layer — *built 2026-06-08; superseded 2026-06-10 by the grouped layer panel below.*
- [x] **Digitizer-style layer panel (built 2026-06-10, Erfan's Bluebeam-inspired ask):**
      the measurements panel shows ONE group per layer (summed total + run count,
      expandable to the individual runs). Each group has a **record dot** (red pulsing
      = active: new draws keep adding to that layer; green = idle; click to continue
      a layer or stop) and an **eye toggle** (hide a layer from the sheet without
      losing values; hidden layers aren't clickable). Counts re-arm the SAME record.
      Plus: picking any measure tool starts fresh — **empty layer name + auto-rotated
      new color** (12-color palette, skips colors already in use). "Next step: Scope"
      button in the viewer toolbar. *(Pending Erfan's live click-test.)*

### Phase 5b — Smart measurement (built on the core, incremental, AI-assists-you-confirm)
*Easiest first; each is a suggestion the user approves — the AI never finalizes a number.*
- [ ] **Auto-detect scale** — AI reads the title block / scale note and suggests it (feasible)
- [ ] **Snap to lines & corners** — cursor snaps to the drawing's real geometry + ortho lock (hard)
- [ ] **Auto-count symbols** — pick one symbol, AI finds & counts the matches to review (hard)
- [ ] **AI takeoff suggestions** — AI proposes likely measurements as a checklist to accept/edit (ambitious)

### Phase 6 — Markup & Annotation
*Goal: review and communicate on the plans.*
- [ ] Tools: rectangle, line, cloud, highlight, text note
- [ ] Markups saved per sheet as editable data (never baked into the PDF)
- [ ] Show/hide layers

### Phase 7 — AI scope of work  ← IN PROGRESS (pipeline built 2026-06-08)
*Goal: Claude reads schedules/notes and drafts scope by CSI division.*
- [x] Send the plan set to Claude (the trimmed PDF as a document) + takeoff drivers + notes
- [x] Read door/window/finish schedules and general notes (PDF vision)
- [x] Draft scope by CSI division — Sonnet draft + Opus gap-finder/second-opinion pass; saved to `line_items` + `scope_findings`; viewable Scope page
- [x] AI receives the in-app takeoff quantities as structured input (drivers → bloomed scope w/ formula + assumptions + confidence, all "proposed")
- [x] **Editable Scope canvas + answer-the-questions loop (built 2026-06-09):** each line can be confirmed / edited (description, qty, unit) / excluded / restored / permanently deleted, plus add-your-own lines — anything a human touches is protected from the next regenerate (`user_edited`). The AI's "question" findings can be answered inline; answers persist (migration **0010** — `scope_findings.answer/answered_at`), survive a regenerate, and are fed back to both AI passes as authoritative clarifications. Gaps/assumptions/exclusions can be checked off. (Pending Erfan's live test + running 0010.)
- [ ] Remaining: regenerate a single division, chat-to-refine
- [ ] Tune: per-division generation + streaming for large sets; wire company profile from config

### Phase 8 — CSI organization
- [ ] Map measurements + scope into CSI divisions/sections
- [ ] Owner-furnished / out-of-contract items go in **Exclusions** (no Builder's-
      vs-Owner's-cost split — that idea is dropped)

### Phase 9 — Pricing  ← IN PROGRESS (core built 2026-06-10)
- [x] **Pricing page** (`/projects/[id]/pricing`, linked from the project page): every
      active scope line gets a direct cost — **$/unit × quantity or lump sum** — split
      into **labor · material · subcontractor · equipment · other**, each line with a
      source (my number / sub quote / my history / market est.) + confidence + status
      (unpriced → needs-confirm → confirmed). Edit-in-place, Confirm, Clear. Division
      subtotals + Confirmed vs Projected grand totals. Direct cost only — markups are Phase 10.
- [x] **AI price suggestions** (background job w/ progress + cancel, Opus 4.8): prices
      every unconfirmed line from measurements/assumptions/clarifications + your cost
      history; suggestions land amber "needs confirm"; confirmed prices never touched.
- [x] **`cost_database`** — confirming a price snapshots it; history feeds future AI
      suggestions ("prefer the user's own numbers"). *(Needs migration **0011** run.)*
- [x] **History auto-match (built 2026-06-10):** "Suggest prices" now matches your
      price history FIRST (same division + same unit + similar description; most
      recent price wins; >12-month-old prices flagged "verify"); the AI only prices
      what your history didn't cover — repeat jobs get cheaper and more predictable.
      *(Migration **0014** adds the CSI section to the cost database for sharper matching.)*
- [x] **Cost Database page (built 2026-06-10):** sidebar → Cost Database — search,
      edit, and delete your confirmed price history; shows source project + date.
- [x] **Sub-quote flow (built 2026-06-10):** "Sub quotes" section on the Pricing page —
      upload the quote (PDF/photo) and **AI reads it** (sub, trade, CSI divisions, date,
      total, inclusions/exclusions) or enter it by hand; Apply spreads the lump sum
      across the covered divisions' lines (subcontractor bucket, proportional to
      existing prices, 'proposed' until confirmed; confirmed lines never touched);
      Remove un-prices the covered lines. *(Migration **0015**.)*

### Phase 10 — Markups + estimate  ← core built 2026-06-10
- [x] **Estimate page** (`/projects/[id]/estimate`): direct-cost subtotals by division
      (live from priced lines), markup waterfall — contingency → insurance →
      overhead → profit, each on the running total — grand total (the bid number).
      Markup %s save per project (migration **0013**), cells take formulas, warnings
      for unpriced/unconfirmed lines. **Export to Excel (CSV)** with full line detail
      + waterfall. *(Branded .xlsx styling comes with the proposal phase.)*
- [x] **Company settings (built 2026-06-10):** sidebar → Settings — company identity
      (name/address/phone/email/license, feeds the Phase 11 letterhead) + **default
      markup percentages**; a project's Estimate starts from the defaults until its
      own markups are saved. *(Migration **0016**.)*

### Phase 11 — Proposal  ← core built 2026-06-10
- [x] **Proposal page** (`/projects/[id]/proposal`): white "paper" preview — letterhead
      from Settings (name/address/phone/email/license), To/RE/Date block, **AI-drafted
      editable cover letter** (saved per project, migration **0017**), CSI cost summary
      table (divisions → subtotal → markups → total), **Assumptions & Exclusions**
      (unresolved AI findings), acceptance signature block. **Print / Save as PDF**
      prints only the paper (print CSS verified shipped). Pre-send warning when
      prices are unconfirmed/unpriced. Project card + Estimate next-step wired.
- [ ] Letterhead logo image; richer styling; per-line detail appendix option

### Phase 12 — Polish + platform fit
- [ ] Settings, benchmarks ($/SF, $/unit), embed-as-a-tab, deploy to the web
- [ ] **Server-side PDF compression** (Ghostscript-style: downsamples images, KEEPS vector text), run on **every** upload. Needs a server runtime with the compression binary (a small service alongside deploy) — decided 2026-06-05 to wait for this rather than rasterize/lose text in-browser.

> **Interim storage note:** until server compression exists, uploads are the (uncompressed) trimmed PDFs. Files over the Supabase **free-tier 50 MB cap won't upload** — big sets (e.g. the 172 MB Cleon set, even trimmed) need either **Supabase Pro** or the compression above. Small/medium trimmed sets work today.

---

## How we work through it

One phase at a time, top to bottom. Each ends with something you can click and
use, shown to you before we move on. The Plan Workspace (Phases 3–5) is the
biggest, most technical part — built in small, testable steps. Nothing ships,
deletes, or publishes without your say-so.

*Last updated: 2026-06-05*
