# Scope of work — structure, breakdown and format

Design work for feedback item **C1**. This is the "how should the scope of work
actually be built" question, researched against how the industry does it and
grounded in what our app currently produces.

---

## 1. What we produce today

Measured off the live database, 2026-09-08:

| Project | Lines | Divisions | Sections |
|---|---|---|---|
| 24632 Santa Clara Ave (SFR) | 160 | 22 | 101 |
| 5147 Garden Grove Ave | 148 | 21 | 91 |
| 21222 W Lopez | 135 | 20 | 76 |
| 8950 Dayton Way | 131 | 18 | 68 |
| 25831 S Western Ave | 119 | 12 | 52 |
| Erwin St — 12-unit apartments | 89 | 23 | 79 |

The shape is **flat**: one row per CSI section, in division-code order. A
typical line reads:

> `22 40 00 · Plumbing Fixtures — 8 ea`

**The count is not the problem. The shape is.** Three things are wrong with it:

1. **It's a filing code, not a scope.** "Plumbing Fixtures — 8 ea" tells a
   client nothing about what we're doing. MasterFormat is a system for
   organising *specifications by material*. We're using it as though it were a
   description of work.
2. **It's flat.** 160 rows in one list, at one level. There's nothing between
   "the project" and "a line", so the user has no way to read it at a summary
   level, and no way to hand a coherent package to a sub.
3. **Nothing in it can become a schedule activity.** A schedule activity needs a
   deliverable, a responsible party, a duration and a predecessor. A CSI section
   code supplies none of those.

---

## 2. What the industry actually does

### Two formats, two jobs

MasterFormat is **material-based** and is used during detailed design and
construction for specifications. UniFormat is **systems-based** and is used in
early design for conceptual estimates. Professionals use both, keyed together —
they aren't competitors, they answer different questions.

We're currently using MasterFormat to do both jobs, which is why the output
reads like a spec index instead of a scope of work.

### The WBS, and the rule that governs it

A construction WBS is a hierarchical breakdown of all the work, starting with
major deliverables and breaking down into work packages. Most projects use
**three levels**; only long, capital-intensive projects go to five or six.

The lowest level you plan and control is the level where you can **assign a
responsible party, estimate cost and duration, and measure percent complete
without a debate**. That sentence is the whole test.

Three rules from the research that we should adopt outright:

- **The 100% rule.** The children of any node must sum to exactly 100% of the
  parent. No work outside the tree, no work counted twice.
- **Deliverables, not activities.** Every work package should be a **noun**, not
  a verb. "Framing — second floor", not "Frame the second floor."
- **No overlap.** Each package is discrete.

### How estimating connects to scheduling

This matters because Erfan wants a scheduling section later, and the decision
made now either enables it or blocks it.

The industry model separates three things that we currently conflate:

- The **WBS** is the logical hierarchy of *what is being delivered*.
- **Activities** (the schedule) show *how and when* each WBS element is
  delivered.
- **Cost codes** (the estimate) show *how costs are collected and reported*
  against the WBS.

Each schedule activity is tied to a WBS element **and** a cost code, and the
same codes are used in the programme, the estimate, the cost system and the
reports. That's what makes a cost-loaded schedule possible.

**The implication for us is direct:** the CSI code should be an *attribute* of a
work package, not the thing that defines it. Keep the code — our Cost Database
and unit-price history already key off it, and subs expect it — but stop letting
it dictate the structure.

### What a client-facing scope of work contains

Separately from the internal WBS, the document a client signs is expected to
carry: scope details, materials and specifications, **exclusions**, milestones,
timeline, payment schedule, and a change-order process — organised **by trade**.
The exclusions section is the one that prevents most disputes.

Note that this is a **different view of the same data**, organised by trade and
written in plain language. It is not a different set of records.

---

## 3. Recommendation

### Three levels

```
Level 1   Project
Level 2   Trade package        ← what a sub bids, what the client reads
Level 3   Work package         ← what we estimate, schedule and mark complete
          └─ CSI code, quantity, unit, evidence  (attributes, not structure)
```

**Level 2 — Trade package.** 15–25 of these for a house or ADU. Deliverable
nouns organised the way work actually gets bought: Site & Demolition, Concrete &
Foundations, Framing, Roofing, Windows & Doors, Plumbing, HVAC, Electrical,
Insulation & Drywall, Finishes, Cabinets & Countertops, Exterior & Landscape,
General Conditions. This is the layer the client reads and the layer a sub bids.
It is also the natural unit of a schedule bar.

**Level 3 — Work package.** 5–12 under each trade package. This is the level
that passes the test above: one responsible party, one estimate, one duration,
percent complete without argument.

That lands at roughly **100–250 lines for a house** — which is almost exactly
where our generator already sits. So the AI is producing about the right *volume*
of thinking. It's filing it wrong.

For contrast, a fully detailed MasterFormat residential estimating spreadsheet
runs 500+ lines. We should not chase that number. That level of detail belongs
to a cost database, not to a scope a client reads.

### What changes on a line

Today:

> `22 40 00 · Plumbing Fixtures — 8 ea`

Proposed:

> **Plumbing** → **Fixture set — install**
> 8 ea · CSI 22 40 00
> *Includes:* set and connect owner-supplied fixtures at 2 baths, kitchen, laundry.
> *Excludes:* fixture supply, trim upgrades.
> *From:* fixture count, sheets A-2.1 / P-1

Same record, three additions: a **trade package** above it, a plain-language
**deliverable name**, and its own **inclusions/exclusions**. The CSI code moves
to the end where it belongs — a cost-coding attribute, not a headline.

### Why this unlocks scheduling later

Once Level 2 exists, a schedule is mostly already there. A trade package becomes
a schedule bar; the work packages inside it become the activities; sequence is a
`sequence_order` on the trade package (which is roughly fixed for residential
construction and can ship as a sensible default); durations come from quantity ÷
crew rate, which the Cost Database can learn over time.

Without Level 2, building a scheduler later means re-deriving the grouping from
CSI codes with a lookup table — guessing at the structure we should have stored.

---

## 4. What this needs in the data model

Additive only, no destructive change:

| Change | Table | Why |
|---|---|---|
| `trade_package` (text) | `line_items` | Level 2 grouping |
| `trade_sequence` (int) | `line_items` | construction order, drives schedule later |
| `deliverable` (text) | `line_items` | plain-language noun name |
| `includes` (text) | `line_items` | what the line covers |
| `excludes` (text) | `line_items` | line-level exclusions |

`division_code` / `section_code` stay exactly as they are and keep feeding the
Cost Database. Existing rows keep working — an ungrouped line falls into a
trade package derived from its division code.

## 5. What this changes in the UI

- Scope canvas becomes a **two-level accordion**: trade packages collapsed by
  default, each showing its line count and total; work packages inside.
- The client-facing proposal renders the same records **by trade**, in plain
  language, with the exclusions section pulled together at the bottom (which is
  also feedback items **D3–D4**).
- The user reads 18 headings instead of scrolling 160 rows, and opens only the
  trade they care about.

---

## 6. Suggested order of work

1. Migration adding the five columns (additive, no data loss).
2. AI prompt updated to emit trade package + deliverable + includes/excludes.
   Back-fill mapping for existing rows from division code.
3. Scope canvas rebuilt as the two-level accordion.
4. Proposal renders by trade with the exclusions block.
5. *(Later, separate round)* Scheduling reads trade packages as bars.

Steps 1–2 are the ones that must be right, because they're what later work
depends on. Steps 3–4 are presentation and can iterate.

---

## Sources

- [Construction Work Breakdown Structure: examples and template — Smartsheet](https://www.smartsheet.com/content/construction-work-breakdown-structure)
- [Work Breakdown Structure (WBS): basic principles — PMI](https://www.pmi.org/learning/library/work-breakdown-structure-basic-principles-4883)
- [Work Breakdown Structure: elements, formats, best practices — Hexagon](https://aliresources.hexagon.com/enterprise-project-performance/work-breakdown-structure-wbs-elements-formats-best-practices)
- [MasterFormat, UniFormat and construction cost estimating](https://www.linkedin.com/pulse/masterformattm-uniformat-construction-cost-estimating-peter-cholakis)
- [Using MasterFormat and UniFormat — Join](https://success.join.build/en/knowledge/using-masterformat-and-uniformat-in-join)
- [Cost-loaded construction schedule — Procore](https://www.procore.com/library/cost-loaded-construction-schedule)
- [Aligning WBS and CBS for total cost control — PMWeb](https://pmweb.com/news/work-and-cost-breakdown-structures-based-monitoring-evaluating-and-reporting-of-cost-performance-on-capital-construction-projects)
- [Residential construction scope of work template — Houzz Pro](https://pro.houzz.com/pro-learn/blog/startup-guide-residential-construction-scope-of-work-template)
- [Free construction scope of work templates — Smartsheet](https://www.smartsheet.com/content/construction-scope-of-work-templates)
