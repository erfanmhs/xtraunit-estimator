# Touch interaction model — the takeoff viewer

*Version 1 · 2026-09-06 · branch `feat/touch-native`*

This is the gesture contract for the plan/takeoff viewer on phones and tablets. It
is written so that anyone (Erfan, a partner, a future developer) can read a
gesture off the table and know what the app will do. The code follows this
document, not the other way round.

The model is settled: **two fingers always navigate, one finger is the tool.**
Everything below is the detail that makes that rule hold up under a real thumb.

---

## 1. What the good apps do

I looked at how the apps people already trust on an iPad handle this.

| App | Two fingers | One finger | Select / edit an existing shape | Precision |
|---|---|---|---|---|
| **Bluebeam Revu (tablet mode)** | Pan and pinch-zoom, even with a markup tool active. | The active tool. Bluebeam auto-detects a stylus: when one is present, finger = navigate/select only, stylus = draw. | Tap a markup to select; drag its handles. Long-press = the right-click menu. | Stylus. Double-tap stylus opens a zoom control. |
| **Fieldwire** | Pan and pinch-zoom. | The active markup tool; a point per tap, double-tap to finish a shape. | Select tool then tap; "Move / Resize" drags the shape's handles. Long-press a markup = delete / edit text. | Zoom in first. |
| **Concepts** | Pan, pinch-zoom, rotate. Two-finger tap = undo. | Draw. Touch-and-drag an existing stroke moves it. | Tap-and-hold a stroke selects it; a popup offers scale / stretch / rotate / delete; corner control points transform it. | Zoom; snap. |
| **Procreate** | Pinch-zoom, rotate; quick pinch = fit to screen. Two-finger tap = undo, three = redo. | Paint. | Hold after a stroke to snap it to a straight line / shape. | Apple Pencil hover for size. |
| **PlanGrid / Procore Drawings** | Pan and pinch-zoom. | Markup tool. | Tap selects, handles drag. Long-press = context actions. | Zoom. |

Three things every one of them agrees on, and which this document adopts:

1. **Two fingers never draw.** Navigation is always available without changing
   tool. Bluebeam is the direct precedent for a takeoff app.
2. **Tap selects, handles edit, long-press opens the menu.** Nobody invents a
   new vocabulary for editing.
3. **Precision comes from zoom plus an aid** (loupe, snap, or a stylus). A
   fingertip is 40–50 css px wide; nothing is placed accurately at 1:1 zoom on a
   phone, so the app has to help.

Sources: [Bluebeam — Revu on tablets](https://support.bluebeam.com/user-manual/tablets.html),
[Bluebeam — navigate](https://support.bluebeam.com/user-manual/navigate.html),
[Fieldwire — mobile plan view and markup](https://help.fieldwire.com/hc/en-us/articles/360049713811-Introduction-to-the-Plan-View-and-Markup-Tools-Mobile),
[Fieldwire — edit, resize, duplicate markups](https://help.fieldwire.com/hc/en-us/articles/115004752483-How-to-edit-resize-and-duplicate-Markups),
[Concepts — top gestures](https://concepts.app/en/tutorials/the-top-gestures-of-concepts-pros/),
[Procreate — gestures](https://help.procreate.com/procreate/handbook/interface-gestures/gestures).

---

## 2. The five rules

1. **Two fingers = navigate, always.** Pinch zooms about the midpoint, moving
   both fingers together pans. Works in every tool, and never places a point,
   never moves a vertex, never opens a menu. Anything one finger had started is
   cancelled the moment a second finger lands.
2. **One finger = the active tool.** In **Pan** it pans (and double-tap zooms
   in). In a drawing tool it places a point where the finger **lifts**, with a
   loupe while it is down. In **Select** it taps to select and drags handles.
3. **Tap a shape to select it; tap empty space to deselect.** A selected shape
   shows every vertex as a touch-sized handle. Drag a handle to move that
   corner, with the loupe. This works in Select. Holding on a vertex works in
   **any** tool (rule 4).
4. **Long-press = the menu.** Holding still on a shape, a vertex, an empty spot
   or a sheet row opens the same menu a right-click gives on desktop. Holding on
   a **vertex** does one better: after the hold it is already grabbed, so the
   finger can slide it straight away without switching to Select first.
5. **Nothing is gesture-only.** Every gesture has a visible button that does the
   same thing (Finish / Undo point / Cancel pill, +/− zoom, the Edit panel's
   handles hint, the menu's Delete). Gestures are the fast path, not the only
   path.

---

## 3. Gesture table, per tool

"Tap" = down and up within 300 ms, moved less than 10 px. "Hold" = 450 ms still
(≤ 10 px). "Drag" = moved more than 8 px. Two fingers = any two fingers,
regardless of what the first was doing.

| Tool | 1-finger tap | 1-finger drag | 1-finger hold | 2 fingers | Double-tap |
|---|---|---|---|---|---|
| **Pan** | Nothing (tap on a shape selects it and switches to Select) | Pan | Menu (shape → shape menu; empty → tool switcher) | Pinch-zoom + pan | Zoom in 2× at the tap |
| **Select** | Select the shape under the finger; tap empty = deselect; tap a handle = make it the active vertex (nudge pad appears) | On a handle: move that vertex (loupe on). On a selected filled shape's interior: move the whole shape. Elsewhere: nothing (no accidental pan) | On a vertex: grab it. On a shape: menu. Empty: tool switcher | Pinch-zoom + pan; cancels any drag and restores the vertex | Zoom in 2× |
| **Line / Calibrate / Leader** | Place point where the finger lifts | Aim: the loupe follows the finger, the rubber-band follows; the point lands on lift | On a vertex of an existing shape: grab it (edit). On a shape: menu. Empty: tool switcher | Pinch-zoom + pan; no point placed | — |
| **Polyline / Wall / Volume (linear)** | Add a point on lift. Tap the last point again = finish. | Aim with the loupe | Same as Line | Same | Finish (also the ✓ button) |
| **Area / Volume (area)** | Add a corner on lift. Tap the first point = close. | Aim with the loupe | Same as Line | Same | Close shape (also the ✓ button) |
| **Count** | Add a marker (auto-saved). Tap a marker = remove it. | Aim with the loupe | Same as Line | Same | — |
| **Crop** | Nothing | Draw the crop rectangle (held to the paper shape) | Menu | Pinch-zoom + pan; cancels the drag | — |
| **Sheet row (left list)** | Open the sheet | Scroll the list | Sheet menu: Open, Rename, Delete sheet | — | — |

Keyboard and mouse behaviour is unchanged (right-drag / Space / middle-drag to
pan, wheel to zoom, Esc, Delete, double-click to finish).

---

## 4. Selecting and editing a shape by touch

This is the part the user called out, so it is spelled out step by step.

**Select.** In the Select tool, tap anywhere on a shape (its line, its fill, or
a count marker). The shape gets a white outline and every vertex becomes a
handle. A short caption appears in the bottom pill: "Drag a handle · hold a
handle for the nudge pad".

**Edit a corner (the direct way).** Put a finger on a handle and slide. The loupe
opens above the finger showing the drawing magnified 2.5× with a crosshair at
the exact point. The vertex follows the finger; the length / area label updates
live. Lift to commit. The measurement value is recomputed and saved.

**Edit a corner from any tool (the hold way).** In any drawing tool, hold on an
existing vertex for 450 ms without moving. The handle enlarges and pulses once
(visual "grabbed" cue); now slide it. This means a user drawing walls can fix a
corner they misplaced two shapes ago without hunting for the Select tool. On
lift the app stays in the drawing tool, draft untouched.

**Fine adjustment (the nudge pad).** Tap a handle without dragging it. It turns
into the *active vertex* (filled garnet), and a small pad appears at the bottom
of the drawing: four arrows and a step size (¼ ft · 1 ft · 1 px). Each arrow
tap moves the vertex by one step in page space. This is the answer to "I can
get it close with my finger but not exact". The pad disappears on deselect.

**Move the whole shape.** Select a filled shape (area / volume-area) and drag
its interior. Lines and polylines are moved from the menu ("Move") to avoid
fighting with the aim gesture.

**Deselect.** Tap empty canvas, or tap the ✕ in the Edit panel, or press Esc.

**Delete.** Long-press the shape → Delete; or the Edit panel's Delete; or the
Delete key.

**Handles that overlap.** If two handles of the same shape are within one hit
radius of each other (a tight corner at low zoom), the app picks the nearest
and the loupe shows which one moved. Zooming in separates them; that is the
expected fix and is what every reference app does.

---

## 5. The context menus

One menu component, four contents. Opened by long-press (touch) or right-click
(mouse). Items are 44 px tall on touch.

| Opened on | Items |
|---|---|
| A shape | Edit (switch to Select with it selected) · Duplicate · Move · Properties (opens the Edit panel) · **Delete** |
| A vertex of the selected shape | Nudge (opens the pad) · Delete this point (polylines / areas with more than the minimum points) · Split segment here (polylines / areas) |
| Empty canvas | Switch tool: Select · Line · Area · Polyline · Wall · Volume · Count · Leader · Crop |
| A sheet row | Open · Rename · Categorize (discipline) · Delete sheet |

---

## 6. Conflict handling — how one finger is told apart from two

The hard cases, and the rule for each. The numbers are the ones in the code.

**Second finger arrives while the first is "doing something".**
The first finger is always cancelled, whatever it was doing, and the touch
becomes a pinch:

| First finger was… | On second finger |
|---|---|
| Aiming a point (loupe open) | Loupe closes, no point is placed on lift (`pinchedRef`). |
| Dragging a vertex | The vertex snaps back to where it was (edit geometry discarded). Nothing is saved. |
| Panning (Pan tool) | Pan hands over to pinch seamlessly. |
| Waiting for a long-press | Timer cleared; no menu. |
| Drawing a crop rectangle | Rectangle discarded. |

Because drawing tools place the point on **lift**, not on **press**, there is
nothing to undo when a pinch starts. This is why the lift model was chosen over
place-on-press: it makes two-finger navigation free of side effects with no
timing tricks.

**One-finger drag in Select: is it a vertex drag or a stray touch?**
A vertex drag starts only if the press landed within the handle's hit radius
(section 7). Elsewhere in Select, one finger does nothing on drag, so a thumb
resting on the screen never moves the sheet or a shape. To pan in Select, use
two fingers (or switch to Pan).

**Hold vs tap vs drag.**
A press starts a 450 ms timer. Moving more than 10 px cancels it (it is a drag
or an aim). Lifting before it fires is a tap. If it fires, the press becomes a
hold: the menu opens (or the vertex is grabbed) and the eventual lift places
nothing.

**Double-tap vs two taps.**
Two taps within 300 ms and 24 px of each other are a double-tap. In Pan it
zooms; in polyline/area tools it finishes the shape. Because a single tap in a
drawing tool already placed a point on the first lift, a double-tap there
finishes with that point included, which matches desktop double-click.

**Two-finger tap (undo) — deferred.**
Concepts and Procreate use a two-finger tap for undo. It is cheap to add
(both fingers down and up within 250 ms, under 10 px travel) but it collides
with the start of a hesitant pinch. It stays out of version 1; the Undo button
is in the phone bottom bar instead.

**Browser gestures.**
The viewport sets `touch-action: none` and `overscroll-behavior: contain`, so
Safari never scrolls the page, pulls to refresh, or pinch-zooms the whole site
while a finger is on the drawing. The viewport meta keeps user zoom enabled
everywhere else (accessibility).

---

## 7. Hit targets and sizes

All in css pixels at the screen, independent of drawing zoom. "Coarse" = the
`(pointer: coarse)` media query, i.e. a finger. Mouse sizes in brackets.

| Thing | Visual size | Hit size |
|---|---|---|
| Vertex handle | 22 px circle (10 px) | 44 px circle — `TOL × 1.6` at 16 px tolerance (25 px) |
| Active vertex | 26 px, garnet fill | 44 px |
| Line / polyline / area edge | 2 px stroke | 32 px band, 16 px each side (16 px) |
| Count marker | 12 px circle | 32 px |
| Filled shape interior | — | the polygon itself |
| Menu item | 44 px tall | 44 px |
| Bottom pill buttons (Finish etc.) | 40 px tall | 44 px |
| Tool buttons, pager, Back | 44 px min | 44 px |
| Sheet row | 44 px | 44 px |
| Nudge pad arrows | 44 px | 44 px |
| Loupe | 120 px, 2.5× magnification, centred 90 px above the finger | — |

Rule of thumb from Apple's guidelines and WCAG 2.5.5: 44 px minimum. Where a
visual is smaller than that (a handle), the hit area is still 44 px.

---

## 8. Precision aids

1. **Loupe.** Whenever a finger is aiming (placing a point, dragging a vertex,
   calibrating), a 120 px circle shows the drawing at 2.5× with a crosshair,
   offset 90 px above the fingertip so the finger does not hide it. Near the
   top edge of the screen it flips below the finger.
2. **Nudge pad.** Section 4. Step sizes ¼ ft / 1 ft / 1 px; the default is 1 px
   when no scale is set, ¼ ft when one is.
3. **Zoom is the first tool.** The caption under the pager says so on first
   use: "Pinch to zoom in before placing a point". At 4× a fingertip covers
   about 12 drawing points, which is inside the tolerance of a takeoff.
4. **Snap to a nearby vertex (later).** When a placed point lands within the
   hit radius of an existing vertex of another shape, snap to it. Not in
   version 1; listed in section 11.
5. **Length readout while aiming.** The rubber-band shows the live length /
   area in the bottom pill so a wall can be drawn to a known dimension without
   hitting the corner exactly.

---

## 9. Phone vs iPad — the honest split

| | Phone (≈ 375–430 px wide) | iPad (768 px and up) |
|---|---|---|
| Navigation and viewing | Excellent. Pinch, pan, page, categorize, notes. | Excellent. |
| Counting | Good. Tap-per-item with the loupe; markers are 32 px targets. | Excellent. |
| Lines, walls, areas | **Workable, not fast.** Every point needs a zoom-in; the loupe + nudge pad get you to within a few inches. Realistic use: fix a couple of points, add a missing wall, check a dimension on site. | **Good.** Screen is big enough to work at 2–3× with the whole room in view. This is the device for a full takeoff by touch. |
| Editing a corner | Good. Tap-select, drag handle with loupe, nudge pad. | Good. |
| Side panels (sheet list, Edit panel) | Overlay one at a time; the drawing is the screen. | Side by side, as on desktop. |
| Stylus | Not applicable. | Apple Pencil works as a fine one-finger pointer today (pointerType "pen" is treated like touch). Bluebeam's finger-navigates / pencil-draws split is a version 2 item. |
| Performance | Raster capped at 12 M pixels; large E-size sheets render slightly soft past 3× zoom. Tiles fix this (section 11). | 12 M cap as well for now; the same tile work lifts it. |

The plain statement: a phone is for looking, checking, counting and small fixes.
An iPad is a real takeoff device. The gesture model is identical on both, so
nothing has to be relearned.

---

## 10. What is in the code today vs what this document adds

| Behaviour | Before this branch | After |
|---|---|---|
| Two-finger pinch/pan in any tool | Yes | Yes, plus it now cancels a vertex drag and a crop drag |
| One finger places on lift with loupe | Yes | Yes |
| Long-press menu on shape / canvas / sheet row | Yes (500 ms) | Yes (450 ms), plus vertex menu |
| Tap to select / tap empty to deselect | Select tool only, on press | Select tool on lift; Pan tool tap-on-shape switches to Select |
| Drag a handle | Select tool, 22 px handle | Same handle, 44 px hit, loupe while dragging, live label, pinch-safe |
| Hold a vertex in any tool to grab it | No | Yes |
| Nudge pad | No | Yes |
| Move a whole filled shape | No | Yes (drag interior in Select) |
| Vertex menu (delete point / split) | No | Yes |
| Menu items 44 px on touch | No | Yes |
| Double-tap to finish a shape | No (desktop double-click only) | Yes |
| Main app navigation reachable from the viewer on a phone | No (Back only) | Yes — a "Go to" sheet in the bottom bar (Plans · Scope · Pricing · Estimate · Proposal · Projects) |

---

## 11. Later (not in this round)

- Snap a placed point to a nearby vertex of another shape.
- Two-finger tap = undo, three-finger tap = redo, behind a setting.
- Apple Pencil mode: pencil draws, fingers only navigate (Bluebeam's split).
- Tile-based rendering to lift the 12 M pixel cap on big sheets.
- Rotate the sheet with a two-finger twist (rarely needed for plans; skipped).
- Lasso multi-select.
- Haptic tick on snap / hold-grab (Safari exposes none; would need a native shell, which is out of scope).

---

## 12. Testing checklist (phone width 375 px, tablet width 768 px)

- Two fingers in Line tool: zoom and pan, no point placed, draft untouched.
- Second finger while dragging a handle: vertex returns to its start, nothing saved.
- Tap a wall in Select: handles appear; drag one with the loupe; length label updates; value saved.
- Hold a vertex in Area tool: grabbed and moved; tool still Area; draft intact.
- Tap a handle, use the nudge pad: vertex moves one step per tap; value saved on the last tap.
- Long-press a shape: menu with 44 px items; Delete removes it; Undo brings it back.
- Long-press a sheet row: Open / Rename / Categorize / Delete sheet.
- Double-tap in Polyline with 2+ points: shape finishes.
- Bottom "Go to" opens the stage list; Scope link leaves the viewer.
- Nothing scrolls the page or triggers Safari's pull-to-refresh at any point.
