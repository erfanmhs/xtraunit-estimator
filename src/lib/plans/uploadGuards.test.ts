import { describe, expect, it, vi } from "vitest";
import {
  DESKTOP_WARN_BYTES,
  HARD_LIMIT_BYTES,
  MB,
  PHONE_WARN_BYTES,
  explainOpenFailure,
  formatMb,
  sizeVerdict,
  withTimeout,
} from "./uploadGuards";

describe("sizeVerdict", () => {
  it("lets a normal set through on every device", () => {
    expect(sizeVerdict(40 * MB, true).kind).toBe("ok");
    expect(sizeVerdict(40 * MB, false).kind).toBe("ok");
  });
  it("warns a phone sooner than a laptop", () => {
    const heavy = PHONE_WARN_BYTES + MB;
    expect(sizeVerdict(heavy, true).kind).toBe("warn");
    expect(sizeVerdict(heavy, false).kind).toBe("ok");
    expect(sizeVerdict(DESKTOP_WARN_BYTES + MB, false).kind).toBe("warn");
  });
  it("refuses over the hard limit everywhere, and says how big", () => {
    const v = sizeVerdict(HARD_LIMIT_BYTES + MB, false);
    expect(v.kind).toBe("refuse");
    if (v.kind === "refuse") expect(v.message).toMatch(/501 MB/);
  });
});

describe("formatMb", () => {
  it("shows a decimal only for small files", () => {
    expect(formatMb(2.34 * MB)).toBe("2.3 MB");
    expect(formatMb(123.4 * MB)).toBe("123 MB");
  });
});

describe("withTimeout", () => {
  it("resolves when the work finishes first", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, "work")).resolves.toBe(7);
  });
  it("rejects with a readable message and fires the cancel hook", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const never = new Promise<number>(() => {});
    const p = withTimeout(never, 5000, "Rendering page 3", onTimeout);
    const caught = p.catch((e: Error) => e.message);
    vi.advanceTimersByTime(5001);
    await expect(caught).resolves.toBe("Rendering page 3 took longer than 5 s");
    expect(onTimeout).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("explainOpenFailure", () => {
  it("maps the usual pdf.js failures to plain sentences", () => {
    expect(explainOpenFailure(new Error("No password given"))).toMatch(/password-protected/);
    expect(explainOpenFailure(new Error("Invalid PDF structure"))).toMatch(/isn't a readable PDF/);
    expect(explainOpenFailure(new Error("Array buffer allocation failed"))).toMatch(/out of memory/);
    expect(explainOpenFailure("weird")).toBe("Couldn't read this PDF: weird");
  });
});
