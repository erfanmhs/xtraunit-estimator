# AI Construction-Drawing Reading — State of the Art (2024–2026)

Deep-research brief for the XtraUnit Estimator. 25 sources fetched, 25 claims
adversarially verified (3-vote), 10 findings survived. Cited below. **This field
moves fast — re-verify specs before implementing.**

## The one finding that matters

Frontier vision-LLMs (Claude Opus 4.x, GPT-5.x, Gemini 3 Pro) **read the TEXT on
drawings extremely well (up to ~0.95 accuracy) but lack "drawing literacy"** —
they are unreliable at:
- **Counting symbols** (doors/windows) — only ~0.40–0.55 exact-match, 20–50% off.
- **Spatial reasoning** under dense annotation/clutter.
- **Cross-sheet / cross-view correspondence** (matching a wall in plan to its
  section detail, resolving callouts/keynotes across pages).

Five independent 2025–26 benchmarks converge on this same text-strong / symbol-weak
gradient (AECV-Bench, MechVQA, ArchPlanVQA, CEQuest, AEC-Bench). The diagnosed
cause is **weak domain priors + unreliable spatial reasoning — not bad OCR.**

**Architectural implication (academically recommended):** treat the LLM as the
**reasoning / text / scope layer**, and keep **counting either human-verified or
offloaded to a dedicated detector**. Pure-VLM takeoff counting is not trustworthy
yet.

## What this validates in what we've already built

- **Text-first reading** (extract the PDF text, send that) — correct; it's the
  LLM's strongest mode (0.95). [Anthropic vision/PDF docs]
- **Split + downscaled "vision PDF" for large/scanned sets** — this is literally
  Anthropic's own recommended fix for oversized PDFs. [Anthropic PDF docs]
- **Prompt caching across per-division chunks** — the correct cost lever; cache
  reads are 0.1× and PDFs/images in user turns are cacheable. [Anthropic caching docs]
- **Per-CSI-division chunking** — necessary; dense PDFs exhaust the context window
  before the page limit. [Anthropic PDF docs]
- **"A human confirms every number"** — this isn't just our moat, it's the
  academically-recommended safeguard given unreliable VLM counting.

We are, structurally, aligned with the state of the art.

## The biggest upgrade opportunities (ranked)

1. **Structured parsing + retrieval for cross-sheet reasoning.** AEC-Bench (the
   most on-target benchmark) showed that adding a structured document
   representation + retrieval to the agent **uniformly improved cross-sheet tasks
   across every model** — spec↔drawing sync **+20.8**, drawing navigation
   **+18.75**, detail/technical review **+32.2**. This is *the* validated fix for
   your stated goal ("navigate the relationship of the pages with each other").
   For us: build a **sheet index** (sheet #, title, discipline, what's on it,
   callouts/keynotes/grid refs it points to) and let the AI retrieve the right
   sheets instead of swallowing the whole set. Caveat: structured parsing *hurt*
   purely visual tasks (note-callout −3.6%), so keep the raw sheet image available
   too.
2. **High-resolution tiling of dense sheets.** Sending a whole downscaled sheet
   blurs keynotes/schedules. Claude's high-res tier allows ~2576px / 4784 tokens
   (~3× standard) and tokenizes in 28×28 patches. **Tile/crop dense sheets** so
   each tile stays under the limit — preserves the small text, dimensions and
   symbols the model needs. Keep tiles ≤2000px and ≤20 image blocks/request to
   avoid silent extra downscaling. [Anthropic vision docs]
3. **Keep counting human-verified; a dedicated CV detector is the eventual path.**
   Dedicated detectors beat VLMs at symbol counting (Faster R-CNN 83% mAP, YOLO
   79%; few-shot viable with <10 instances/class; hybrid raster+vector like
   DPSS/ArchCAD-400k reads CAD directly). Big lift — not now, but the right
   long-term answer for auto-counts.
4. **Two-pass routing** (cheap model picks relevant sheets → expensive model reads
   only those). Matches both the AEC-Bench retrieval result and practitioner
   guides. Overlaps with #1.

## Honest gaps in this research

- **Commercial products couldn't be independently verified.** Vendor accuracy
  claims (Togal ~97% space detection / 12-min takeoff; "95–99%") are marketing and
  appear to be **human-in-the-loop CV pipelines** — a different category from
  general VLMs, not apples-to-apples with our approach.
- Some benchmarks are **small or adjacent-domain** (P&ID, mechanical parts) —
  directional evidence of a general VLM weakness, not construction-takeoff numbers.
- Even on a *text-only* construction MCQ benchmark (CEQuest), no model broke 80%.
  Realistic expectations matter.

## Sources (verified)
- AECV-Bench — arxiv.org/abs/2601.04819
- MechVQA — arxiv.org/pdf/2605.30794
- ArchPlanVQA — ascelibrary.org/doi/10.1061/JCCEE5.CPENG-7571
- AEC-Bench (Nomic AI) — arxiv.org/abs/2603.29199
- CEQuest — arxiv.org/html/2508.16081v1
- DPSS / ArchCAD-400k — arxiv.org/html/2503.22346v3
- Symbol detection (Faster R-CNN/YOLO) — link.springer.com/article/10.1007/s10032-024-00492-9
- Few-shot symbol detection — tandfonline.com/doi/full/10.1080/08839514.2024.2406712
- Anthropic vision / PDF / caching docs — platform.claude.com/docs
- Practitioner: eano.com, roboticsandautomationnews.com (Feb 2026 tool test), LlamaIndex agentic document workflows
