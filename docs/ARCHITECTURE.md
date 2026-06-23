# XtraUnit Estimator — Architecture Brief

A one-page technical overview for an external code review. Diagrams (architecture
+ full database schema) are in `docs/xtraunit-estimator-architecture.pdf`
(and the source SVGs alongside it).

---

## 1. What it is

A web app that turns a set of construction plans into a priced bid: upload plans →
keep the relevant sheets → do quantity takeoff on the drawings → an AI blooms those
measured "drivers" into a full CSI scope of work → price each line → roll markups
into a bid → produce a client-ready proposal (PDF). The core idea: a human measures
a few things and confirms every price; the AI fills in the breadth, never the final
number.

## 2. Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Next.js 16 (App Router), Tailwind v4 |
| PDF in the browser | `pdfjs-dist` (render), `pdf-lib` (trim / export) |
| Backend | Next.js Server Components + Server Actions (Node runtime) |
| Database / auth / files | Supabase — Postgres + Row-Level Security, Auth, Storage |
| AI | Anthropic Claude — Messages API + Files API |
| Hosting | Render (web service, single instance) |

Anthropic model roles live in **one file**, `src/config/ai.ts` (env-overridable):
scope draft = Opus 4.8, scope review = Sonnet 4.6 (a *different* model on purpose,
for an independent second opinion), pricing = Opus 4.8, quote-read / letters = Sonnet.

## 3. Architecture (request flow)

```
Browser (React)
  PDF.js render · SVG measure overlay · pdf-lib trim/export · undo/redo · optimistic UI
        │  server actions / RSC
Next.js 16 @ Render
  Server Components (read, via RLS) · Server Actions (write) · fire-and-forget AI jobs
        │  SQL + Storage (RLS)              │  AI calls + Files API
Supabase                                   Anthropic Claude
  Auth · Postgres + RLS · Storage          Messages (Opus/Sonnet) · Files API · JSON output
```

- **Reads** go through Server Components that query Supabase with the user's session;
  RLS enforces ownership in the database, not in app code.
- **Writes** are Server Actions. Most UI is optimistic (apply locally, fire the
  action, revert on failure).
- **Heavy/long work** (AI scope, AI pricing) runs as a background job — see §5.

## 4. The pipeline

| Stage | What happens | Key files |
|---|---|---|
| Plans | Trim a PDF to the kept pages **client-side** (`pdf-lib`), upload only the trimmed file to Storage | `projects/[id]/PlanTriage.tsx` |
| Prepare | Extract each sheet's text **client-side** (`PDF.js`) and cache it; flag image-only sheets for vision | `projects/[id]/scope/PreparePlans.tsx` |
| Takeoff | Measure on an SVG overlay over the PDF canvas (line/area/wall/volume/count/leader); undo/redo; on-sheet legend; multi-page marked-up PDF export | `plans/[planId]/PlanViewer.tsx` |
| AI Scope | Background job: gather context → upload plans (Files API) → draft (Opus, chunked) → gap-review (Sonnet) → write `line_items` + `scope_findings` | `lib/scope/{bundle,generate,run}.ts` |
| Pricing | Deterministic match against the user's own price history, then AI prices the rest (Opus); 5 cost buckets; confirming a price snapshots it to the cost DB | `lib/scope/{price,match,items}.ts` |
| Estimate | Live division subtotals + a markup waterfall (contingency → insurance → O&P) → grand total + $/SF | `projects/[id]/estimate/` |
| Proposal | AI-drafted project narrative + reusable company sections + scope table (priced or included/excluded) + waterfall → Print / Save as PDF | `projects/[id]/proposal/` |

## 5. The signature pattern — background AI jobs

Long AI work can't block an HTTP request, so:

1. A Server Action validates and inserts a `scope_runs` row (`status='running'`).
2. It spawns a **fire-and-forget** async job (`void runScopeGeneration(...)`) in the
   **same Node process** and returns immediately.
3. The job can't use request cookies, so it **re-authenticates with the user's access
   token** (a fresh Supabase client) and reports progress by updating the `scope_runs`
   row; the UI polls it.
4. Work: `gatherBundle` → `uploadPlanFiles` (streamed one file at a time to the Files
   API) → `draftScope` (Opus, division chunks, 2 at a time, `Promise.allSettled` so one
   chunk's failure doesn't sink the run) → `findGaps` (Sonnet) → write rows.
5. **Cancel** = an in-process `AbortController` keyed by run id + a DB flag. A run with
   no heartbeat for >3 min is treated as dead and auto-recovered.

> **Review flag:** this works only because the web service is a single instance.
> It's the deliberate, cheap choice for now; the documented next step is a real job
> queue + worker process (so jobs survive restarts and the service can scale out).

## 6. Auth & security

- **Auth:** Supabase email auth; a `profiles` row is created by a DB trigger on signup.
- **Row-Level Security:** every domain table has `owner_id` and an RLS policy
  `auth.uid() = owner_id` for select/insert/update/delete. Ownership is enforced in the
  database — server code does not hand-filter by user.
- **Storage:** plans live in a private `plans` bucket; access is per-owner.
- **Hardening still open (pre-wide-launch):** disable public signups (add users by
  hand), and set Supabase Auth Site/Redirect URLs to the production domain.

## 7. Data model

15 tables, grouped: **project/takeoff** (`projects → plan_files → sheets →
measurements`), **scope & pricing** (`line_items`, `scope_findings`, `scope_runs`,
`sub_quotes`), **sell** (`estimates`, `proposals`), **cost DB spine**
(`cost_database` = price observations → `cost_items` = canonical catalog), and
**identity** (`profiles`, `company_settings`). Full column-level schema with foreign
keys: **page 2 of the PDF** / `docs/db-schema.svg`. Schema changes are plain numbered
SQL files in `supabase/migrations/` (0001–0024), run by hand in Supabase; status is
tracked in `supabase/PENDING-DB-CHANGES.md`.

## 8. Error handling & resilience

- **Migration-tolerant reads:** queries that touch newer columns fall back to a
  smaller select if a migration hasn't run, so the app degrades instead of 500-ing.
- **Partial-success AI:** scope drafting is chunked with `Promise.allSettled`; a failed
  chunk is counted and the user is told to regenerate, rather than losing the whole run.
- **Optimistic UI with rollback** across the editing surfaces.
- **Undo/redo** in the takeoff editor is snapshot-based and **reconciles the database**
  (re-insert / update / delete) so an undo actually persists.
- **Memory:** plan files are streamed to the AI one at a time (never all held in
  memory as base64) — this was a real out-of-memory cause on the small instance.

## 9. Deployment

- GitHub `main` → **Render auto-deploys** (`render.yaml`). Secrets are set in the Render
  dashboard, not in git.
- **One Supabase project backs both local dev and production**, so a migration is run
  once and applies everywhere.
- Build gate: `tsc --noEmit` + `next build` (ESLint runs in the build).

## 10. Honest review notes / known limitations

- **Single instance + fire-and-forget jobs** (§5) — the main architectural debt. No job
  queue yet; a process restart drops an in-flight generation.
- **No automated test suite** — correctness today rests on `tsc`, ESLint, and manual
  testing.
- **Two ESLint rules are downgraded to warnings** (`react-hooks/set-state-in-effect`,
  `react-hooks/immutability`) so `next build` passes; they flag long-standing prop-sync
  effects across several components that haven't been refactored.
- **Heavy client-side work:** PDF trim + per-sheet text extraction + the takeoff/export
  pipeline all run in the browser. Great for cost and latency; assumes a capable client.
- **`PlanViewer.tsx` is large** (~3.4k lines) — the most complex file; a candidate for
  decomposition.

## 11. Where to read the code

```
src/config/ai.ts                         model role map (env-overridable)
src/lib/scope/                           AI engine: bundle, generate, run, price, match, items, subquote
src/lib/supabase/                        client/server Supabase factories
src/app/(app)/projects/[id]/             pipeline UI: plans, scope, pricing, estimate, proposal
src/app/(app)/cost-database/             cost DB hub (history, items catalog, benchmarks)
supabase/migrations/                     numbered SQL schema (source of truth)
```
