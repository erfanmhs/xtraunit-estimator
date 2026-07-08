# XtraUnit Estimator — Commercial-Readiness Audit

**Date:** 2026-07-06 · **Scope:** the whole repo, read-only. **Reference:** the
13-layer "senior full-stack" stack. **Baseline commit:** `2fbb2ba` plus the
in-review sheet-routing changes in the working tree (a product feature; it does
not touch any infrastructure layer below).

> **How to read the ratings.** *Missing* = not there. *Basic* = works but naive /
> manual / single-user-grade. *Solid* = well-built, a real gap or two from
> commercial. *Production-grade* = you'd ship it to paying customers as-is.
>
> **The one-line verdict:** the *product* layers (frontend, backend logic, data
> model, RLS) are genuinely strong — the hard, valuable part is done well. The
> *operational* layers (observability, rate limiting, CI, scaling, recovery) are
> early. You have a working product that isn't yet operationally hardened for
> paying, multi-customer scale.

---

## Scorecard

| # | Layer | Rating |
|---|---|---|
| 1 | Frontend | **Solid** |
| 2 | APIs & Backend Logic | **Solid** |
| 3 | Database & Storage | **Solid** |
| 4 | Auth & Permissions | **Basic** |
| 5 | Hosting & Deployment | **Solid** |
| 6 | Cloud & Compute | **Basic** |
| 7 | CI/CD & Version Control | **Basic** |
| 8 | Security & RLS | **Solid** (RLS is production-grade; app-layer hardening missing) |
| 9 | Rate Limiting | **Missing** |
| 10 | Caching & CDN | **Basic** (domain caching is smart; HTTP/CDN unconfigured) |
| 11 | Load Balancing & Scaling | **Basic** (vertical only; horizontal blocked by design) |
| 12 | Error Tracking & Logs | **Missing** |
| 13 | Availability & Recovery | **Basic** |

---

## 1. Frontend — **Solid**

**What exists.** React 19 + Next.js 16 App Router + Tailwind v4
(`package.json:15-19`). 13 routed pages (`src/app/**/page.tsx`) covering the full
pipeline: projects, plan triage, takeoff viewer, scope, pricing, estimate,
proposal, cost database, settings. The takeoff editor
(`src/app/(app)/projects/[id]/plans/[planId]/PlanViewer.tsx`, ~3.4k lines) is a
serious piece of interactive UI — SVG measure overlay, undo/redo, on-sheet
legend, PDF export. Optimistic UI with rollback is used across the editing
surfaces. Custom "glass" design system; print CSS for proposals.

**Gaps vs. commercial-grade.**
- **No error boundaries.** There is no `error.tsx`, `global-error.tsx`, or
  `not-found.tsx` anywhere under `src/app/` (verified by glob). A thrown render
  error in any client component shows the default Next error screen, not a
  branded, recoverable one.
- **No loading states / Suspense** (`loading.tsx`) — navigations block on the
  server fetch with no skeleton.
- **No component tests** and no accessibility pass (no automated a11y checks;
  custom controls in `PlanViewer` need keyboard/ARIA review).
- **`PlanViewer.tsx` is a 3.4k-line monolith** — maintainability risk; flagged
  in `docs/ARCHITECTURE.md:136`.

**Recommendations.**
- *Quick win:* add `src/app/global-error.tsx` + a route-group `error.tsx` and a
  `not-found.tsx`. A few hours; big perceived-polish and resilience gain.
- *Quick win:* add `loading.tsx` skeletons for the heavier pages (scope,
  pricing, plan viewer).
- *Bigger lift:* decompose `PlanViewer` into tool/panel modules; add Vitest +
  React Testing Library for the pricing/estimate math and the formula evaluator
  (`src/lib/formula.ts`) — pure logic that's high-value to test.

## 2. APIs & Backend Logic — **Solid**

**What exists.** Server Components for reads + Server Actions for writes (e.g.
`src/app/(app)/projects/[id]/scope/actions.ts`), and one route handler for the
email-confirm flow (`src/app/auth/confirm/route.ts`). The AI engine
(`src/lib/scope/*.ts`) is well-factored: `gatherBundle → draftScope → findGaps`,
streamed structured JSON output, division-chunked with `Promise.allSettled`
fault tolerance, and **migration-tolerant reads** that fall back to a smaller
`select` when a newer column is absent (`src/lib/scope/bundle.ts`). Every action
re-checks `auth.getUser()` and returns a typed `{ ok, error }`.

**Gaps.**
- **No input validation layer.** Server-action inputs are used directly; there's
  no schema validation (zod is not an app dependency — see `package.json`).
  Malformed input relies on Postgres/RLS to reject it.
- **Background jobs are in-process, fire-and-forget** (`src/lib/scope/run.ts`
  keeps a `Map` of `AbortController`s) — no queue, no retry-on-crash, no
  idempotency key. A process restart drops an in-flight job (self-documented in
  `ARCHITECTURE.md:80-83`).
- **No API versioning or contract** — fine while everything is server actions,
  but worth noting if you ever expose a public API.

**Recommendations.**
- *Quick win:* add **zod** and validate every server-action argument at the
  boundary; return friendly errors instead of leaning on the DB.
- *Bigger lift:* move background AI work to a real queue (see Layer 6).

## 3. Database & Storage — **Solid**

**What exists.** Supabase Postgres with **26 numbered migrations**
(`supabase/migrations/0001…0026`). Clean schema with foreign keys + cascade
deletes, `updated_at` triggers and a new-user profile trigger
(`0001_phase1_projects.sql:31-102`), indexes on hot columns (e.g.
`projects_owner_id_idx`, `plan_files_project_id_idx`), and a well-designed
cost-database "spine" (`0021`). Files live in a **private** Storage bucket with
per-user-folder access rules (`0002_phase2_plans.sql:36-56`). Change process is
documented and disciplined (`supabase/PENDING-DB-CHANGES.md`).

**Gaps.**
- **Migrations are applied by hand** in the Supabase SQL editor — there's no
  `supabase/config.toml` and no CLI/CI migration step. That's a correctness and
  drift risk (a forgotten migration = a broken deploy; the app hides this with
  fallback selects, which masks the problem rather than preventing it).
- **No generated TypeScript types** from the schema (`supabase gen types`), so
  DB shapes are hand-typed in each query and can drift from reality.
- **One Supabase project backs both dev and prod** (`ARCHITECTURE.md:120-122`) —
  convenient, but a bad migration or data edit hits production immediately.

**Recommendations.**
- *Quick win:* generate types (`supabase gen types typescript`) and replace the
  hand-written row types in `bundle.ts`/`page.tsx`.
- *Bigger lift:* adopt the Supabase CLI so migrations are versioned and applied
  by command (and later by CI); add a **separate staging Supabase project** so
  prod isn't the test bed.

## 4. Auth & Permissions — **Basic**

**What exists.** Supabase email auth. A middleware gatekeeper
(`src/proxy.ts` — Next 16 renamed `middleware` to `proxy`; matcher at
`src/proxy.ts:17-21`) calls `updateSession()`
(`src/lib/supabase/middleware.ts`), which refreshes the token and redirects
signed-out users to `/login`. Password reset + email-confirm flows exist
(`src/app/reset-password/page.tsx`, `src/app/auth/confirm/route.ts`).
Authorization is enforced in the **database** via RLS, not app code (see Layer
8) — the right place for it.

**Gaps.**
- **No multi-tenant model.** Everything is per-user (`owner_id`). There are no
  organizations/teams, so partners can't share a project or a cost database.
  `profiles.role` exists but defaults to `'member'` and is **unused**. Company/
  team accounts are explicitly deferred (`DEPLOY.md:84-86`).
- **Open signup is a live foot-gun.** Anyone who finds the URL can register and
  spend your Anthropic budget; the only mitigation is a **manual** Supabase
  toggle you have to remember (`DEPLOY.md:42-47`). Nothing in code enforces it.
- **No MFA, no SSO, no RBAC, no audit log** of who did what.

**Recommendations.**
- *Quick win:* confirm public signup is OFF in Supabase and add an allow-list
  check so it's enforced, not just configured.
- *Bigger lift (pre-customer):* introduce an `organizations` + `memberships`
  model and rewrite RLS to `org_id`-based policies; wire `profiles.role` into
  real roles (owner/estimator/viewer). This is the single biggest structural
  change between "my tool" and "a product I sell to companies."

## 5. Hosting & Deployment — **Solid**

**What exists.** Render web service defined as code (`render.yaml`): Node 22,
`npm ci && npm run build` → `npm run start`, health check at `/login`, secrets
marked `sync: false` (filled in the dashboard, never in git). Push to `main` →
Render auto-deploys. A genuinely good, non-technical deploy guide
(`DEPLOY.md`).

**Gaps.**
- **`render.yaml:19` pins `plan: starter`**, but your notes say the running
  service was upgraded to Standard (2GB) in the dashboard. The blueprint and
  reality have drifted — anyone re-provisioning from `render.yaml` gets Starter.
- **No staging environment and no preview deploys** — every push tests in prod.
- **Single instance** (correct for now; see Layers 6/11) — one box is the whole
  app.

**Recommendations.**
- *Quick win:* reconcile `render.yaml` to the real plan so the blueprint is
  truthful.
- *Medium:* add a staging service + a `develop`/PR preview so changes are seen
  before they hit customers.

## 6. Cloud & Compute — **Basic**

**What exists.** One Node process serves the web app **and** runs the AI jobs in
the background (`src/lib/scope/run.ts`). Memory is handled carefully — plan PDFs
are streamed to the Files API one at a time rather than all held as base64
(`ARCHITECTURE.md:113-116`), a real fix for an earlier OOM.

**Gaps.**
- **No separation of web vs. worker compute**, no queue, no autoscaling. The
  fire-and-forget model means compute can't be scaled or isolated; a heavy
  generation competes with request-serving on the same box.
- Concurrency ceiling is "whatever one instance can hold."

**Recommendations.**
- *Bigger lift (keystone):* a **job queue + separate worker** — e.g.
  Supabase Queues/`pg-boss` on the existing Postgres (no new infra), or
  Upstash QStash / Inngest for a managed option. This unlocks Layers 11 and 13
  at the same time and is the documented "permanent cure" (`DEPLOY.md:88-89`).

## 7. CI/CD & Version Control — **Basic**

**What exists.** Git + GitHub, `main`-based, Render auto-deploys on push.
`.gitignore` is correct (`.env*` ignored, template kept; sensitive
`assets/Sample contracts/` and `.benchmarks/` excluded).

**Gaps.**
- **There is no CI.** No `.github/workflows` directory exists. Nothing runs
  `tsc`, ESLint, or `next build` automatically on a PR. The build gate is a
  **manual honor-system step** ("run `npm run build` before you push" —
  `DEPLOY.md:64-70`).
- **No tests to run** even if CI existed (Layer 1).
- No branch protection evidence; commits go straight to `main`.

**Recommendations.**
- *Quick win (highest effort-to-value in this layer):* a GitHub Actions workflow
  that runs `npm ci`, `npx tsc --noEmit`, `npm run lint`, and `npm run build` on
  every PR, plus branch protection requiring it green. Half a day; stops broken
  deploys cold.

## 8. Security & RLS — **Solid** (RLS is production-grade; app-layer hardening missing)

**What exists.** **This is a genuine strength.** Every domain table has RLS
enabled with per-owner `auth.uid() = owner_id` policies for select/insert/
update/delete (12 migration files carry RLS; e.g. `0001`, `0002`, `0007`,
`0021`). Storage objects are locked to the owner's folder
(`0002_phase2_plans.sql:43-56`). Secrets are server-only and guarded — the
Anthropic client and every `lib/scope` module start with `import "server-only"`
(`src/lib/anthropic.ts:16`), so a key can never be bundled to the browser. The
service-role key is **not** used anywhere (good — no RLS-bypass path in app
code).

**Gaps.**
- **No HTTP security headers.** `next.config.ts` is empty — no
  Content-Security-Policy, HSTS, X-Frame-Options, or Referrer-Policy. (The app
  is also intended to be embeddable in a tab, which needs a deliberate
  frame-ancestors policy rather than none.)
- **No input validation / sanitization layer** (Layer 2).
- **No dependency scanning** (Dependabot / `npm audit` in CI) and **no secret
  scanning**.
- Abuse protection is absent (Layer 9).

**Recommendations.**
- *Quick win:* add a `headers()` block in `next.config.ts` (CSP incl. a
  considered `frame-ancestors`, HSTS, `X-Content-Type-Options`,
  `Referrer-Policy`). A `nonce`-based CSP is the strong version.
- *Quick win:* enable Dependabot + `npm audit --production` in CI.

## 9. Rate Limiting — **Missing**

**What exists.** Nothing. No rate-limiting code or dependency anywhere (verified
by grep across `src/`); no per-job AI **cost cap**. "Per-job AI limits" is an
open TODO (`DEPLOY.md:79`).

**Why it matters here specifically.** Open signup + an unlimited "Generate"
button that spends real Anthropic money = a direct path to a surprise bill,
accidental or malicious. This is the highest *risk-to-cost* gap in the audit.

**Recommendations.**
- *Quick win:* **Upstash Ratelimit** (`@upstash/ratelimit` + Upstash Redis) or a
  Postgres-backed counter on the fire-and-forget entry points (`startScope`,
  `startPricing`, the sub-quote reader) — per-user, per-day caps on AI runs.
- *Quick win:* a hard per-project / per-day **generation count** and a monthly
  token budget, surfaced to the user, before any AI call is made.

## 10. Caching & CDN — **Basic** (domain caching is smart; HTTP/CDN unconfigured)

**What exists.** The *application-level* caching is genuinely clever:
- **Anthropic prompt caching** across the six draft chunks + the review pass
  (`cache_control` breakpoints in `src/lib/scope/generate.ts`) — reads at ~10%
  cost.
- **Per-sheet text extraction cached** in the DB so heavy PDFs aren't re-sent
  (`sheets.extracted_text`, migration `0009`); the compact "vision PDF" is built
  once and its path stored (`0025`).
- Files API uploads are reused within a run.

**Gaps.**
- **No deliberate HTTP caching / CDN strategy.** `next.config.ts` sets no
  `Cache-Control` headers and no image config. Static assets are served by
  Render's edge with defaults; there's no CDN in front of the app for the
  dynamic/ISR layer, and no use of Next's `revalidate`/tags for the mostly-read
  pages (cost database, settings).

**Recommendations.**
- *Quick win:* set `Cache-Control` on static/image responses and consider
  `revalidate` on read-mostly Server Components.
- *Medium:* if latency matters as you add users outside Oregon, put a CDN
  (Cloudflare) in front, or reconsider a platform with a built-in edge (Vercel)
  for the web tier while keeping the worker on Render.

## 11. Load Balancing & Scaling — **Basic** (vertical only; horizontal blocked by design)

**What exists.** Render terminates TLS and serves the single instance. Supabase
scales independently by tier. You can scale the web box **vertically** (bigger
plan).

**Gaps.**
- **Horizontal scaling is impossible today.** The in-process job registry
  (`src/lib/scope/run.ts`) means a second instance couldn't see or cancel jobs
  started on the first; `render.yaml` deliberately omits `numInstances` for
  exactly this reason (comments at `render.yaml:10-13`). So there is no load
  balancer across app instances and can't be until the queue lands.
- No autoscaling, no surge headroom for concurrent generations.

**Recommendations.**
- *Bigger lift:* the same **queue + worker** from Layer 6 is the unlock — once
  jobs live in Postgres/Redis instead of process memory, you can run N stateless
  web instances behind Render's balancer and M workers.

## 12. Error Tracking & Logs — **Missing**

**What exists.** Effectively nothing. There is **no logging or error-tracking of
any kind** in `src/` — zero `console.error`/`console.warn`, no Sentry, no
structured logger (verified by grep). The only failure trail is in the database:
a failed AI run writes a message to `scope_runs.error`
(`src/lib/scope/run.ts:234-239`), and actions return `{ ok, error }` strings to
the UI. There are no error boundaries to catch client crashes (Layer 1).

**Why it matters.** You are operating a live product **blind**. If a user hits a
bug tonight, there is no alert, no stack trace, no breadcrumb — you'd only learn
of it if they told you, and you couldn't diagnose it after the fact.

**Recommendations.**
- *Quick win (top of the whole roadmap):* add **Sentry** (`@sentry/nextjs`) —
  server + client + a `global-error.tsx` hook. ~1–2 hours, and it instantly
  converts "blind" into "notified with a stack trace."
- *Quick win:* a thin structured logger (pino) around the AI jobs so run
  failures, token usage, and durations are queryable.

## 13. Availability & Recovery — **Basic**

**What exists.** Supabase Pro provides **daily database backups**
(`DEPLOY.md:53-54`). The app has a nice in-product resilience touch: stale
"running" jobs are auto-recovered so a dead process can't wedge future runs
(`getScopeRun` / `startScope` staleness logic in
`src/app/(app)/projects/[id]/scope/actions.ts:40-63,326-336`).

**Gaps.**
- **Single instance = single point of failure**; no redundancy, no failover.
- **No uptime monitoring or alerting** (no health-check pinger, no status page,
  no on-call signal). The Render health check restarts the box but nobody is
  told.
- **No disaster-recovery runbook**, and **no tested restore** — untested backups
  are a hope, not a plan. No backup of the Storage bucket (plan PDFs) is
  documented.

**Recommendations.**
- *Quick win:* add uptime monitoring (Better Stack / UptimeRobec / Cronitor) on
  a real health route, wired to email/SMS.
- *Quick win:* a one-page DR runbook and **one practiced restore** from a
  Supabase backup into a scratch project.
- *Medium:* confirm Storage-bucket backup coverage; document RPO/RTO once you
  have paying users.

---

## Overall readiness

**≈ 60% of the way to a commercial-grade, multi-customer SaaS** — but that single
number hides a real split:

- **Product & data layers (1, 2, 3, 8-RLS): ~80%.** The estimating pipeline, the
  schema, the row-level security, and the UX are the hard, valuable parts, and
  they're built to a Solid standard. This is well above a beginner's
  "frontend + backend" and shows senior instincts (RLS-in-the-DB, prompt
  caching, memory-safe file streaming, migration-tolerant reads).
- **Operational & scale layers (6, 7, 9, 11, 12, 13): ~35%.** Observability,
  rate limiting, CI, horizontal scale, and recovery are early or absent. These
  are what separate "a working app my partners use" from "a product I can sell,
  operate, and sleep through."

**Stage:** a strong, functional **late-MVP / private-beta** — safe for hand-picked
partners on the current single-instance setup, **not yet ready** to open to
paying, self-serve customers. The gating items before that are money-protection
(rate limits + cost caps), visibility (error tracking), and the multi-tenant/
team model.

---

## Prioritized roadmap (impact vs. effort)

Ordered so the cheapest, highest-impact protections come first.

1. **Error tracking + error boundaries — Sentry** *(Layers 12, 1)* · **quick
   win, do first.** ~1–2 hrs. Stops you operating blind; adds `global-error.tsx`
   as a bonus.
2. **Rate limiting + per-job AI cost cap + enforce closed signup** *(Layers 9,
   4)* · **quick win.** Directly protects your Anthropic bill from accident and
   abuse. Upstash Ratelimit or a Postgres counter on `startScope`/`startPricing`.
3. **CI pipeline + branch protection** *(Layer 7)* · **quick win.** GitHub
   Actions running `tsc` + lint + build on every PR. Half a day; ends broken
   deploys and makes every later change safer.
4. **App-layer security hardening** *(Layer 8)* · **quick-to-medium.** Security
   headers in `next.config.ts` (CSP incl. a real `frame-ancestors` for the
   embed story), zod validation on server-action inputs, Dependabot.
5. **Multi-tenant: organizations + memberships + roles** *(Layer 4)* ·
   **bigger lift, but the gate to selling.** Rewrites RLS from `owner_id` to
   `org_id`; activates the unused `profiles.role`. Do before real customers, not
   after — retrofitting is far worse.
6. **Job queue + worker** *(Layers 6, 11, 13)* · **biggest lift, highest
   structural payoff.** Postgres-backed (`pg-boss`/Supabase Queues) needs no new
   infra. Unlocks restart-survival, horizontal scaling, and real availability in
   one move. It's the keystone the architecture docs already point at.
7. **Availability basics: uptime monitoring + a tested restore** *(Layer 13)* ·
   **quick-to-medium.** Cheap insurance; do alongside #6.

*Supporting/quality items to fold in opportunistically:* generated Supabase
types + Supabase CLI migrations + a staging project (Layers 3, 5); a Vitest suite
for the pricing/formula logic (Layer 1); decomposing `PlanViewer.tsx` (Layer 1);
an HTTP caching/CDN pass if you add geographically spread users (Layer 10).
