# Mobile plan — XtraUnit Estimator

Audited 2026-09-06 on the `feat/mobile` branch (which sits on top of the UI
stack: responsive rail, stage tabs, page header, compact rows, layout polish,
proposal redesign, UX cleanup). Every screen was loaded in the browser pane at
**375 px** (iPhone-class phone) and **768 px** (iPad portrait) and compared
against the 2026 checklist below. The app is already *non-broken* on a phone
thanks to the earlier responsive work; this plan is about making it genuinely
**usable** — thumb-driven, no pinch-to-read, forms that bring up the right
keyboard, and an honest answer on the takeoff viewer.

**Effort:** S = an hour or two · M = half a day to a day · L = multi-day.
**Impact:** how much a phone/tablet user's daily work improves.

## The checklist applied

| Practice | Where we stand |
|---|---|
| Mobile-first fluid layout, no pinch-zoom to read, correct viewport meta | Layouts are fluid at every width. Viewport meta was Next's default (fine) — now explicit, with `viewport-fit=cover` for notched phones. No `maximum-scale` (accessibility). |
| Touch: ~44 px targets, tap fallback for every gesture, WCAG 2.2 contrast | Most buttons were 28–34 px tall; chips 22 px. Fixed globally for touch devices (see Phase 2). The viewer's gestures have partial tap fallbacks (see Takeoff). Contrast: garnet on near-black passes for text; muted `#a1a1aa` on `#0a0a0b` ≈ 8:1 ✓. |
| Data tables: scroll / stack-into-cards / hide-secondary-behind-tap; keep semantic tables; virtualize long lists | Pricing rows stack into cards on phones (done). Scope rows are one line + expand (done). Estimate and proposal tables are 2–3 narrow columns (fine). Cost DB rows reflow. Long lists (130+ scope lines) are NOT virtualized — see Scope. |
| Forms: single column, large inputs, correct input types, minimal typing | Single column at phone width everywhere. Numeric fields use `inputMode="decimal"`. Phone/email types added. iOS auto-zoom on focus removed (inputs ≥ 16 px on touch). |
| Navigation: thumb-reachable, sticky key actions, no hover-only actions | The left rail was the only nav — top-left, the least reachable spot on a phone. Replaced by a **bottom tab bar** on phones (Phase 2). Hover-only actions made visible on touch. |
| Performance: fast first load | Pages are server-rendered; the heavy client code (pdf.js ~1 MB) loads only on the viewer. No image-heavy screens. Nothing alarming; measured later with a real device. |

## Screen by screen

### Projects list — `/projects`
- **Now:** one card per project (name, client, address, stage dots, money). Single column at 375, 2 at 768. Fine.
- **Problems:** "+ New project" sits top-right (thumb-unfriendly). Cards are Links with no visible press state.
- **Fix:** bottom tab bar reaches Projects; primary action stays in the header (it's the first thing on the page). Add an active-press style on cards. **S / low.** Done: nav.

### Project hub — `/projects/[id]`
- **Now:** header, Plans upload + file list, four stage cards (2-col on tablet, stacked on phone).
- **Problems:** the plan-file row wrapped its three buttons under the name (fixed earlier); the "Click to upload or drag a PDF" dropzone reads like desktop-only. On a phone the browser's file picker opens the camera/files — it works, the copy just doesn't say so.
- **Fix:** copy "Tap to choose a PDF" on touch; stage cards already in the rail/bottom bar. **S / low.**

### Scope + findings — `/projects/[id]/scope`
- **Now:** header with Full building / Specific trades chips and Regenerate; rows one line with ▸ expand; findings as chip rows.
- **Problems:** (1) 130 rows is a long scroll with no jump-to-division; (2) hover-only Confirm/Edit/Exclude on rows appears only when expanded on phone — fine, but on a **tablet** (coarse pointer, wide screen) they never appeared; (3) description wraps to 3–4 lines at 375 because the qty column is fixed.
- **Fix:** show row actions on any touch device (Phase 2, done). Division jump list: a horizontal chip strip of division codes under the header, sticky on phones. Virtualize when a project passes ~300 lines (not yet needed). **M / medium.**

### Pricing — `/projects/[id]/pricing`
- **Now:** sticky totals bar; rows stack into 3 lines on a phone (description / amount + actions / inputs); one line on wide screens.
- **Problems:** the six price inputs wrapped into ragged rows on a phone; the totals bar takes ~120 px of a small screen; "Confirm all (120)" is the right sticky action but sits at the top.
- **Fix:** inputs as a 3-column grid on phones (Phase 2, done): Labor · Material · Sub / Equip · Other · Total, source below. Consider moving "Confirm all" into the sticky bar only. **S / high.**

### Estimate — `/projects/[id]/estimate`
- **Now:** division table (2 cols + %), markups with inputs, grand total box, $/SF.
- **Problems:** markup rows are 4-column flex (label · input · +amount · running) — cramped at 375 but readable. Export CSV is a desktop concept; on phone the useful action is Share/Print.
- **Fix:** markup rows wrap the running total under on phones. **S / low.**

### Proposal — `/projects/[id]/proposal` and the client link `/p/[token]`
- **Now:** the new web proposal was designed mobile-first: section nav bar, sticky total + Accept, tier cards, stacked tables. Verified at 375.
- **Problems:** the owner's editor above the document is long (options + timeline rows are multi-input); the option rows' 5-column grid stacks to 5 rows per option on a phone.
- **Fix:** none blocking. Editor rows could collapse to "title · amount" with details behind expand. **S / low.**

### Cost Database — `/cost-database`
- **Now:** tabs; history rows (description, value summary, meta, Delete); items rows (name + standard price, override input, ×).
- **Problems:** item rows put name, override label + input, and × on one line — at 375 the name gets ~150 px; the edit form's six bucket inputs wrap raggedly; the × delete is a 16 px target.
- **Fix:** rows wrap the controls under the name on phones; bucket inputs in a 3-col grid; × gets a 44 px hit area (Phase 2, done). Search box already full-width. **S / medium.**

### Settings — `/settings`
- **Now:** identity fields (single column on phone), markups, proposal profile (terms, exclusions, references).
- **Problems:** phone/email fields brought up the plain keyboard; the profile section is very long on a phone (7 terms textareas + references).
- **Fix:** `type="tel"` / `type="email"` + autocomplete (Phase 2, done). Collapse the profile sub-sections behind headers on phones. **S / low.**

### Auth — `/login`, `/reset-password`
- **Now:** centered card, `max-w-sm`, email/password with the right types and autocomplete, 6-char min hint.
- **Problems:** none blocking. The card padding (p-8) plus the logo leaves the form a scroll below the fold on the smallest phones in landscape.
- **Fix:** reduce padding at 375; nothing else. **S / low.**

### Takeoff / plan viewer — `/projects/[id]/plans/[planId]` — **the hard part**
- **Now:** on narrow screens both side panels start collapsed so the drawing gets the width; the toolbar scrolls sideways; a bottom bar holds the pager and notes chip. Wheel zoom, right-drag / space / middle-drag pan, click-to-draw measurements, drag vertex handles, double-click rename, right-click context menu. The Crop tool drags a rectangle.
- **Problems on touch, honestly:**
  1. **No pinch-zoom or two-finger pan.** Zoom is wheel-only; pan is right/middle drag or Space. On a phone you can zoom with the browser's own pinch (the page zooms, not the drawing) — that's the "non-broken but unusable" state.
  2. **Drawing with a finger** puts the point under the fingertip, so you can't see where the vertex lands; the vertex-drag handles are 5 px circles; "double-click to finish" and "click the first point to close" are hard on touch.
  3. **Right-click menus** (sheet list, canvas tool switch) have no long-press equivalent.
  4. The 12-button toolbar scrolls sideways; on a phone the important ones (Select, Pan, Line, Area, Count) are off-screen.
  5. Rail + toolbar + bottom bar + notes leave ~60% of a phone's height for the drawing.
- **Fix, in stages:**
  - **Stage A (M, high):** pointer-events based two-finger pinch-zoom + one-finger pan in Pan mode (the canvas already keeps zoom focus math for the wheel); a +/− zoom pair in the bottom bar as the tap fallback; long-press = context menu; tap-and-hold on a vertex shows a magnifier loupe offset above the finger; "Finish" / "Close shape" buttons appear while drawing so no double-tap is needed. Toolbar becomes a bottom sheet on phones with the five core tools first.
  - **Stage B (M, medium):** hit-target sizes for handles and count markers scale with pointer type (12 px on touch); undo/redo in the bottom bar; hide the app rail on the viewer (done) and offer full-screen.
  - **Stage C (L, medium):** an "annotate on site" mode — leader notes and photos from the phone attached to a sheet — this overlaps the PWA/offline decision below.
- **Recommendation:** ship Stages A–B for **tablet first** (an iPad on site is where takeoff on touch is realistic); on a phone the viewer is for *looking*, notes and counts, not full takeoff.

## Structural decisions that need Erfan

1. **PWA / installable + offline.** Valuable in the field (job sites with no signal: open plans, read scope, add notes/counts, sync later). It is a bigger build: a service worker, an offline cache of the current project's plan PDFs (tens of MB), a write queue for notes/measurements with conflict handling, and an "installed app" shell. Estimate **L (1–2 weeks)**. My recommendation: do a read-only installable PWA first (open the app, cached plans and scope viewable offline), and defer offline *writes* until you've watched how it's used on site. **Your call: now, later, or not at all.**
2. **Phone vs tablet priority.** The pricing/scope/proposal screens are phone-ready after Phase 2. The takeoff viewer is a tablet product. I recommend: **phone for everything except takeoff; tablet for takeoff**, and we build the viewer's touch stages for the iPad first. **Your call.**
3. **Bottom tab bar contents.** Phase 2 ships a bottom bar with the three top-level tabs (plus Sign out) outside a project, and the six stage tabs inside one. If you'd rather keep the left rail on phones too, it's a one-line switch. **Confirm or change.**
4. **Viewer full-screen on phones.** Hiding the app chrome entirely in the viewer (a "Back" in the bottom bar is the only way out) buys ~15% more drawing. Done in Phase 2 as the default on phones; say if you want the rail back.
5. **Camera capture.** "Take a photo of a sub's quote" and "photo of the site attached to a sheet" both need the storage bucket for images and (for quotes) already-existing AI reading. Small on their own (**S–M**) but they decide what the phone is *for*. Worth a conversation.

## Phase 2 — done on this branch (no decisions needed)

- Explicit viewport (`viewport-fit=cover`, theme color), no zoom lock.
- Touch devices: every button/select/input at least 44 px tall; inputs never smaller than 16 px text (no iOS zoom-on-focus); hover-revealed actions always visible.
- Bottom tab bar on phones (thumb-reachable), content padded for it; hidden on the viewer, which gets a Back button in its own bar instead.
- Pricing: price inputs as a 3-column grid on phones.
- Cost Database: item and history rows wrap their controls under the name; 44 px delete target; bucket inputs on a grid.
- Settings: phone and email keyboards; address autocomplete. New project: address/organization autocomplete.
- Scope + pricing row actions visible on any touch device (not just when expanded).

## Phase 3 — queued (after your go)

Takeoff Stage A + B (tablet-first) · division jump strip on Scope · Estimate markup wrap · profile sub-sections collapsible · PWA/offline per decision 1 · camera capture per decision 5.
