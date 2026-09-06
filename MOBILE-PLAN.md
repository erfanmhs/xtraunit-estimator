# Mobile plan — XtraUnit Estimator

Audited 2026-09-06 on the `feat/mobile` branch (on top of the UI stack:
responsive rail, stage tabs, page header, compact rows, layout polish, proposal
redesign, UX cleanup). Every screen was loaded in the browser pane at **375 px**
(phone) and **768 px** (iPad portrait) and compared against the 2026 checklist.

**Direction (Erfan, 2026-09-06):** the estimator stays a responsive mobile
**web app in the browser**. No standalone app, no PWA/offline for now — that is
a future phase once the whole app is built out. **The headline goal is the plan
/ takeoff viewer working by touch:** pinch-zoom, pan, and drawing / placing
measurements and markups with fingers, on a phone and on a tablet.

**Effort:** S = an hour or two · M = half a day to a day · L = multi-day.
**Impact:** how much a phone/tablet user's daily work improves.

---

## 1. The centerpiece — the takeoff viewer by touch

### What the viewer is, mechanically (so the approach reuses it)

- The page is rendered by pdf.js into a `<canvas>` at a **raster scale**; an
  `<svg>` overlay on top of it holds every measurement, drawn in **page
  points** (PDF units at scale 1) × the live display `scale`. Zooming changes
  only the CSS size; 160 ms after the zoom settles, the bitmap is re-rendered
  at the new scale so it stays crisp. A **focus point** (a fraction of the page
  under the cursor) is re-anchored by a layout effect so zoom never lurches.
- The viewport is a scroll container; **panning = scrolling** it.
- **Measurements are zoom-independent**: geometry is page points, value is
  computed from the sheet's calibrated scale (points-per-foot). Nothing about
  touch changes storage, scale, or the AI pipeline.
- **Crop sheets** (migration 0035) render only a window of the page by
  offsetting the pdf.js viewport; measurements on a crop are crop-local. The
  touch layer sits on top of that unchanged — a crop is just a smaller page.
- Pointer events already drive drawing (`onPointerDown/Move/Up` on the SVG)
  and panning (on the viewport). Touch fingers arrive as the same events with
  `pointerType === "touch"`, which is the hook everything below hangs on.

### Gesture model (built — commit on `feat/mobile`)

| Gesture | Mouse (unchanged) | Finger |
|---|---|---|
| Zoom | wheel | **two-finger pinch** in any tool; double-tap (Pan tool) zooms 2× at the spot; toolbar −/+/Fit |
| Pan | right-drag, middle-drag, Space+drag, or Pan tool | **two fingers** in any tool; one finger in Pan tool |
| Place a point | click | **touch → slide → lift**: the point goes where the finger lifts; a **loupe** (2.5× magnifier with crosshair) floats above the finger while it's down, so the fingertip never hides the target |
| Finish a run / close a shape | double-click, or click the last/first vertex | **Finish / Close shape** button in a pill above the bottom bar (also Undo point, Cancel) — no double-tap needed |
| Context menu | right-click | **long-press** (0.5 s, finger still) on the drawing or on a sheet row |
| Grab a vertex | 5 px handle | **11 px handle** and a 2× hit tolerance on touch devices |
| Count markers | click | tap (same lift model) |

Implementation notes, for review:
- `touch-action: none` + `overscroll-behavior: contain` on the viewport, so the
  browser hands us every finger instead of scrolling or zooming the page.
- Fingers are tracked in a map on the viewport. Touch pointers are implicitly
  captured by the element they start on and bubble up, so no explicit capture
  is needed and the SVG still gets its own finger's move/lift.
- **Pinch**: distance ratio → `scale`, throttled to one `setScale` per animation
  frame; the fraction of the page under the fingers' midpoint is anchored
  through the existing focus mechanism, so zoom-and-pan happen in one gesture.
  When the distance is steady it's a pure two-finger pan (scroll math only).
- A second finger **cancels** whatever the first was doing (tap, pan) so a
  pinch never leaves a stray vertex.
- The loupe copies the page bitmap from the main canvas (no extra render).

### Precision fallbacks (for when a finger isn't enough)
- The **loupe** is the primary fallback: slide the finger until the crosshair
  sits on the corner, then lift.
- **Undo point** removes the last vertex; vertex handles are draggable
  afterwards with the Select tool.
- **Zoom in first**: pinch to 3–4× makes a 2 px line 8 px wide; tolerances are
  in page points so hit-testing tightens as you zoom.
- Queued (M): a **nudge pad** (←↑↓→ moves the last vertex 1 pt) for cases the
  loupe can't settle; and **snap to line ends** using pdf.js's vector paths.

### Performance with large plan images
- **Bitmap cap on touch devices**: the raster is capped at ~12 M canvas pixels
  (a 24×36 sheet at 3× would be 40 M — past what phones and iPads allocate);
  the CSS size still follows `scale`, only sharpness beyond the cap is traded.
- Pinch updates the CSS size only; the expensive re-raster runs once, 160 ms
  after the last change (existing debounce).
- pdf.js runs in a module worker (already), so parsing never blocks touches.
- Queued (M): **tile rendering** for very large sheets at high zoom (render
  only the visible window at full resolution), and lazy sheet thumbnails in
  the list.

### Layout on a phone (built)
- The app rail is gone on the viewer; the bottom bar holds **Back**, the sheet
  pager, and the Notes chip. The toolbar orders the most-used tools first
  (Select, Pan, Line, Area, Count…) and scrolls sideways.
- Queued (S): move undo/redo into the bottom bar on phones; a "full-screen"
  toggle that also hides the toolbar.

### Verified / not verified
- Verified in the browser pane with touch emulation: finger tap-and-lift
  placement, the loupe, the Finish pill, long-press menus, 44 px targets,
  bottom-bar Back.
- **Not verifiable in the pane:** real two-finger pinch/pan (the emulator has
  one finger). The pinch math reuses the wheel-zoom anchoring, which is
  exercised daily on desktop; the first real test is your phone or iPad.

### Tablet vs phone
- **Tablet (iPad) is where touch takeoff is realistic** — full toolbar,
  side panels can stay open, pinch precision is good. Everything above works
  there first.
- **Phone**: look, pan/zoom, notes, counts, quick lines. Full takeoff on a
  5-inch screen is possible but slow; the plan doesn't pretend otherwise.

---

## 2. The rest of the app (foundations built; all S–M)

| Practice | Where we stand |
|---|---|
| Mobile-first fluid layout, no pinch-zoom to read, correct viewport meta | Fluid at every width. Explicit viewport with `viewport-fit=cover`, no zoom lock. |
| Touch: ~44 px targets, tap fallback for gestures, WCAG 2.2 contrast | Global rule for touch devices: buttons/selects/inputs ≥ 44 px, checkboxes 24 px. Muted `#a1a1aa` on `#0a0a0b` ≈ 8:1. Every gesture has a button fallback (see table above). |
| Data tables | Pricing rows stack into cards (3-col price grid on phones). Scope rows one line + expand. Estimate/proposal tables are 2–3 narrow columns. Cost DB rows reflow. Long lists (130+ scope lines) are not yet virtualized — a division jump strip is queued. |
| Forms | Single column on phones. Numeric fields `inputMode="decimal"`; phone/email types; address/organization autocomplete; inputs never below 16 px (no iOS zoom-on-focus). |
| Navigation | Bottom tab bar on phones (areas, or the six stages inside a project); rail from tablet up; hover-only actions visible on touch. |
| Performance | Server-rendered pages; pdf.js loads only on the viewer. Bitmap cap above. |

### Screen notes (what remains)
- **Projects / New project / Hub:** done. Queued: "Tap to choose a PDF" copy on touch; press state on cards. (S)
- **Scope + findings:** done (rows, chips). Queued: sticky division jump strip on phones; virtualize past ~300 lines. (M)
- **Pricing:** done. Queued: "Confirm all" only in the sticky bar. (S)
- **Estimate:** queued: markup rows wrap the running total under on phones. (S)
- **Proposal:** designed mobile-first; queued: option rows collapse to title · amount. (S)
- **Cost Database:** done. **Settings:** done; queued: collapsible profile sub-sections. (S)
- **Auth:** fine; queued: less card padding at 375. (S)

---

## 3. Decisions for Erfan (updated)

- ~~PWA / installable + offline~~ — **decided: not now.** Future phase.
- ~~Phone vs tablet~~ — **decided by the steer:** touch viewer is the priority
  on both; tablet is where full takeoff is realistic, phone for look/notes/
  counts/quick lines.
- **Bottom tab bar contents** — shipped as described; say if you want the rail
  on phones instead.
- **Camera capture** (photo of a sub's quote; site photo attached to a sheet)
  — small builds that decide what the phone is *for*. Worth a conversation.

## 4. Queue after this
Nudge pad + snap-to-line-ends · tile rendering for huge sheets · undo/redo +
full-screen in the phone bottom bar · division jump strip · the S items above.
