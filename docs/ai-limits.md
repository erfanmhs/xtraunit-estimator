# AI spend protection — the five guards

Every path that spends Anthropic money passes through these, in order. All
defaults are env-overridable (see `.env.local.example`); none needs an
external service.

| # | Guard | Where | Default | What it stops |
|---|---|---|---|---|
| 1 | **Burst limit** per user | `lib/rate-limit.ts` via `enforceAiLimit()` | 10 AI starts / 10 min | A stuck retry loop or a script hammering Generate. In-memory, instant. |
| 2 | **Daily / monthly run counts** per user | `lib/ai-usage.ts` (table `ai_usage`, migration 0027) | 60 / day, 600 / 30 days | Sustained over-use by one account. Durable in the DB. |
| 3 | **Per-run dollar ceiling** | `lib/ai-meter.ts` | $15 per run | One Generate running away (huge plan set, prompt blow-up). Metered from the token counts on every response. |
| 3b | **Monthly dollar budget** per user | `lib/ai-usage.ts` (`getAiSpendThisMonth`, migration 0042) | $25 / 30 days | The slow leak: many normal-sized runs adding up. Sums `scope_runs.cost_usd` (jobs) plus `ai_usage.cost_usd` (one-shot calls, settled after each). Shown under the Generate / Suggest buttons: "AI this month: $x of $25". |
| 4 | **Sign-up limits + switch** | `app/login/actions.ts` | 5 / IP / hour, 30 total / hour; `NEXT_PUBLIC_ALLOW_SIGNUP` | Strangers creating accounts to spend the budget. |

## How the per-run ceiling behaves

- Each background job (scope, apply, pricing) opens a meter (`runWithAiBudget`).
  Every model call inside it checks the ceiling **before** the call and adds its
  cost **after** (`assertAiBudget` / `recordAiUsage`). Parallel chunks share the
  same meter.
- Scope generation hits the ceiling mid-run → it stops drafting further division
  groups, skips the review pass, **saves what was drafted**, and finishes with a
  plain-English status ("Stopped early to protect the AI budget… what was
  drafted is saved…"). Nothing paid for is thrown away.
- Overshoot is at most one call (the check is before each call; a call is
  bounded by its `max_tokens`), so a $15 cap really means "$15 to about $17".
- Prices are list prices per million tokens by model family (Opus / Sonnet /
  Haiku, incl. cache write/read). Unknown models are billed at the Opus rate on
  purpose. Update `PER_MTOK` in `ai-meter.ts` when models or prices change.
- Every call logs `ai.call` (tokens, cost, running job total) and every job
  logs `ai.job.cost`; with migration 0032 the run row also stores `cost_usd`.
  The Done status shows the cost: "Done · ~$3.42 AI".

## Where the rate limiter's memory lives (and its known limits)

Counters live in the Node process (a `Map`). Correct for the current
single-instance Render setup; they reset on a deploy/restart and would not be
shared across instances. When the job-queue / multi-instance upgrade happens,
replace the store in `rateLimit()` with a shared one (Postgres row, or Redis)
— the call sites don't change. The DB-backed guards (#2) are unaffected.

## Sign-up

Creating an account now goes through the `signUp` server action, not the
browser: validated (zod), rate-limited, and refused outright when
`NEXT_PUBLIC_ALLOW_SIGNUP=false` (the form also hides "Create an account").
Sign-in and password reset still talk to Supabase from the browser, where
Supabase's own auth rate limits apply.

## Tuning

| Env | Default | Notes |
|---|---|---|
| `AI_JOB_BUDGET_USD` | 15 | 0 disables the per-run ceiling. |
| `AI_MONTHLY_BUDGET_USD` | 25 | Per user, rolling 30 days; 0 disables. Refuses the next AI start once reached. |
| `AI_BURST_LIMIT` / `AI_BURST_WINDOW_MIN` | 10 / 10 | Per user. |
| `AI_DAILY_LIMIT` / `AI_MONTHLY_LIMIT` | 60 / 600 | Per user; 0 disables a window. |
| `SIGNUP_LIMIT_PER_IP` / `SIGNUP_LIMIT_GLOBAL` | 5 / 30 | Per hour. |
| `NEXT_PUBLIC_ALLOW_SIGNUP` | true | `false` = invite-only. |
