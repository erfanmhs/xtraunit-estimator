# Observability — error tracking + logs

Two pieces, both added 2026-09-05. Neither needs an account to run; Sentry
switches on the moment its DSN env vars are set.

## 1. Sentry (error tracking)

**What it catches once a DSN is set**

| Where | How |
|---|---|
| Server: page renders, route handlers, server actions, the proxy | `src/instrumentation.ts` exports `onRequestError = Sentry.captureRequestError` — Next.js calls it for every unhandled server error, with the route and request attached. |
| Browser crashes | `src/instrumentation-client.ts` initializes the browser SDK before hydration; `app/error.tsx` and `app/global-error.tsx` call `Sentry.captureException` from their effect. |
| Background AI jobs (scope / apply / pricing) | Their `catch` blocks call `log.error(...)`, and the logger forwards `error` and `warn` lines to Sentry. |
| Edge runtime (`src/proxy.ts`) | `sentry.edge.config.ts`, loaded by `register()` when `NEXT_RUNTIME === "edge"`. |

**Files**

- `sentry.server.config.ts`, `sentry.edge.config.ts` — `Sentry.init` for the two server runtimes. `enabled: !!dsn`, so no DSN = disabled.
- `src/instrumentation.ts` — loads the right config per runtime + `onRequestError`.
- `src/instrumentation-client.ts` — browser init + navigation breadcrumbs.
- `next.config.ts` — wrapped in `withSentryConfig`. Source-map upload only runs when `SENTRY_AUTH_TOKEN` is set; otherwise the build is unchanged.
- `src/proxy.ts` — matcher skips `/monitoring` (the tunnel route browser reports post through), so login-page crashes still report.

**Env vars** (all optional; documented in `.env.local.example` and listed in `render.yaml`)

| Var | Where | Purpose |
|---|---|---|
| `SENTRY_DSN` | Render env | Server + edge reporting. |
| `NEXT_PUBLIC_SENTRY_DSN` | Render env | Browser reporting (same DSN value; it's public, not a secret). |
| `SENTRY_ENVIRONMENT` / `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | optional | Label, defaults to `NODE_ENV`. |
| `SENTRY_TRACES_SAMPLE_RATE` / `NEXT_PUBLIC_…` | optional | Performance sampling, default 0.1. |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Render env, build time | Source-map upload so stack traces show real file/line. Optional. |

**Turning it on (Erfan):** sentry.io → free account → Create project → platform "Next.js" → copy the DSN → paste it into both `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` in Render → redeploy. Alerts go to the email on the Sentry account by default.

## 2. Structured logger (`src/lib/log.ts`)

One JSON line per event on stdout/stderr, no dependencies, works in Node, edge and the browser.

```ts
import { log, timer } from "@/lib/log";

const elapsed = timer();
log.info("scope.run.start", { runId, projectId });
…
log.info("scope.run.done", { runId, ms: elapsed(), lines: 130 });
log.error("scope.run.failed", { runId, err });   // err → { name, message, stack }
```

- Levels: `debug | info | warn | error`. `LOG_LEVEL` (default `info`) filters.
- `error` and `warn` also go to Sentry (tagged with the event name) when a DSN is set.
- Event names are dot.case and stable, so Render's log search can filter on them:

| Event | Emitted by |
|---|---|
| `scope.run.start / done / cancelled / failed`, `scope.chunk.failed` | `lib/scope/run.ts` |
| `apply.run.start / done / cancelled / failed` | `lib/scope/run.ts` |
| `pricing.run.start / done / cancelled / failed` | `lib/scope/price.ts` |
| `ai.cap.daily / ai.cap.monthly / ai.cap.skipped / ai.usage.record_failed` | `lib/ai-usage.ts` |
| `subquote.read.failed`, `proposal.narrative.failed`, `profile.draft.failed` | the server actions that were silently swallowing these before |

**Reading the logs on Render:** service → Logs tab → search for an event name, e.g. `scope.run.failed`.

## Uptime (added 2026-09-12)

`GET /api/health` answers `{ ok, db, latencyMs, version }` — 200 when the
app is up AND one round trip to Supabase succeeds, 503 otherwise. Render's
health check points at it (`render.yaml`), so a deploy whose database is
unreachable is not marked live. An outside watcher (UptimeRobot, free plan,
5-minute checks) hits the same URL and emails erfan.mhs@gmail.com on failure.
No secrets in the response; the route is public on purpose.
