import "server-only";

/**
 * Rate limiting — a sliding-window counter kept in this process's memory.
 *
 * Why in-memory and not Redis/Upstash: the app deliberately runs as ONE
 * always-on Render instance (see render.yaml), so one process sees every
 * request and a Map is both correct and free — no account to create, no
 * network hop per check. The known trade-offs, accepted on purpose:
 *   - counters reset when the process restarts (a deploy, a crash);
 *   - a second instance would keep its own counters.
 * When the app moves to multiple instances (the job-queue upgrade), swap the
 * store in `hit()` for a shared one — the call sites don't change.
 *
 * The AI *spend* caps (per-user daily/monthly runs in ai-usage.ts, and the
 * per-job dollar budget in ai-meter.ts) are the durable money guards; this
 * layer is the burst guard in front of them.
 */
import { headers } from "next/headers";
import { log } from "@/lib/log";

type Window = { max: number; windowMs: number };
export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number; error: string };

// key → timestamps (ms) of the hits still inside the window.
const hits = new Map<string, number[]>();
const MAX_KEYS = 20_000; // safety valve so a flood of unique keys can't eat memory

function prune(now: number, windowMs: number, list: number[]): number[] {
  const cutoff = now - windowMs;
  let i = 0;
  while (i < list.length && list[i] <= cutoff) i++;
  return i ? list.slice(i) : list;
}

/**
 * Count one hit against `key`. Refuses (without counting) when the window is
 * full. `what` is a plain-English label for the error message ("sign-ups",
 * "AI runs").
 */
export function rateLimit(
  key: string,
  { max, windowMs }: Window,
  what = "requests",
): RateLimitResult {
  if (max <= 0) return { ok: true }; // 0 = disabled
  const now = Date.now();
  const list = prune(now, windowMs, hits.get(key) ?? []);

  if (list.length >= max) {
    const retryAfterSec = Math.max(1, Math.ceil((list[0] + windowMs - now) / 1000));
    log.warn("rate_limit.hit", { key, max, windowMs, retryAfterSec });
    hits.set(key, list);
    const mins = Math.ceil(retryAfterSec / 60);
    return {
      ok: false,
      retryAfterSec,
      error: `Too many ${what} in a short time. Please wait about ${
        mins > 1 ? `${mins} minutes` : "a minute"
      } and try again.`,
    };
  }

  list.push(now);
  hits.set(key, list);

  if (hits.size > MAX_KEYS) {
    // Drop the oldest entries wholesale; it's a burst guard, not a ledger.
    const drop = hits.size - MAX_KEYS;
    let n = 0;
    for (const k of hits.keys()) {
      if (n++ >= drop) break;
      hits.delete(k);
    }
  }
  return { ok: true };
}

/**
 * The caller's IP, for limiting unauthenticated actions (sign-up). Render sits
 * behind a proxy, so the real address is the first entry of X-Forwarded-For.
 * Falls back to "unknown" — every such caller then shares one bucket, which
 * is the safe direction to fail.
 */
export async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const xff = h.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim() || "unknown";
    return h.get("x-real-ip")?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** The app's limits in one place (env-overridable where it matters). */
export const LIMITS = {
  // Sign-ups: per address, and a global ceiling so a botnet of many addresses
  // still can't mass-create accounts.
  signupPerIp: { max: Number(process.env.SIGNUP_LIMIT_PER_IP ?? 5), windowMs: HOUR },
  signupGlobal: { max: Number(process.env.SIGNUP_LIMIT_GLOBAL ?? 30), windowMs: HOUR },
  // AI starts (Generate / Apply / Suggest prices / read a quote / draft a
  // letter) per user. A full regenerate is ONE start, so real use is a handful
  // per 10 minutes; a stuck retry loop or a script would blow past this.
  aiBurst: {
    max: Number(process.env.AI_BURST_LIMIT ?? 10),
    windowMs: Number(process.env.AI_BURST_WINDOW_MIN ?? 10) * MIN,
  },
} as const;
