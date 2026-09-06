/**
 * Structured logger — one JSON line per event, written to stdout/stderr.
 *
 * Why JSON lines: Render (and every log viewer) can search and filter them,
 * so "show me every failed scope run this week, with how long each took" is a
 * query instead of a scroll. Every line carries a `ts`, a `level`, an `event`
 * name in dot.case ("scope.run.done"), and whatever fields the call site adds.
 *
 * Usage:
 *   log.info("scope.run.done", { runId, ms: 84210, lines: 130 });
 *   log.error("scope.run.failed", { runId, err });   // err → { name, message, stack }
 *
 * `error` and `warn` also forward to Sentry when it's configured (SENTRY_DSN
 * set); with no DSN they are just log lines. Works in Node, the edge runtime,
 * and the browser — no dependencies. LOG_LEVEL (debug|info|warn|error, default
 * info) filters what gets written.
 */
import * as Sentry from "@sentry/nextjs";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
  return ORDER[raw] ?? ORDER.info;
}

/** Turn an Error (or anything thrown) into plain JSON-safe fields. */
export function errorFields(err: unknown): Fields {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(err.cause !== undefined ? { cause: String(err.cause) } : {}),
    };
  }
  return { message: typeof err === "string" ? err : JSON.stringify(err) };
}

function write(level: Level, event: string, fields: Fields = {}): void {
  if (ORDER[level] < threshold()) return;

  const { err, ...rest } = fields;
  const line: Fields = {
    ts: new Date().toISOString(),
    level,
    event,
    ...rest,
    ...(err !== undefined ? { err: errorFields(err) } : {}),
  };

  let text: string;
  try {
    text = JSON.stringify(line);
  } catch {
    text = JSON.stringify({ ts: line.ts, level, event, note: "unserializable fields" });
  }
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);

  // Forward problems to Sentry so they trigger an alert. A no-op without a DSN.
  if (level === "error" || level === "warn") {
    try {
      const extra = { event, ...rest };
      const severity = level === "warn" ? "warning" : "error";
      if (err instanceof Error) {
        Sentry.captureException(err, { level: severity, extra, tags: { event } });
      } else {
        Sentry.captureMessage(event, { level: severity, extra, tags: { event } });
      }
    } catch {
      // Never let telemetry break the app.
    }
  }
}

export const log = {
  debug: (event: string, fields?: Fields) => write("debug", event, fields),
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};

/** A stopwatch for "how long did this take" fields: `const t = timer(); … t()` → ms. */
export function timer(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}
