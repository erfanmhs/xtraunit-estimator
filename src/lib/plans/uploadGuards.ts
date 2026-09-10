/**
 * Guards around dropping a plan PDF (the 47-page set that failed on
 * 2026-09-08 before saving a single page).
 *
 * Page selection is 100 % client-side: the whole PDF is read into the
 * browser, every page is rendered to a thumbnail, and the kept pages are
 * copied into a new PDF. So the limit that bites is the BROWSER'S memory,
 * not the server's: roughly 300–400 MB for a tab on an iPhone against several
 * GB on a laptop. A 99-page set has gone through before; it is file weight
 * (scanned or photographed sheets), not page count, that kills it.
 *
 * Pure functions so the thresholds have tests and one place to tune.
 */

export const MB = 1024 * 1024;

/** Over this the file is refused outright on every device — nothing in the pipeline survives it. */
export const HARD_LIMIT_BYTES = 500 * MB;
/** On a phone, warn above this: it may still work, but the tab may run out of memory. */
export const PHONE_WARN_BYTES = 120 * MB;
/** On a laptop, warn above this. */
export const DESKTOP_WARN_BYTES = 300 * MB;

/** How long one page may take to render a thumbnail before we give up on that page (not the file). */
export const PAGE_RENDER_TIMEOUT_MS = 30_000;
/** How long the whole "read the PDF and open it" step may take. */
export const OPEN_TIMEOUT_MS = 60_000;

export type SizeVerdict =
  | { kind: "ok" }
  | { kind: "warn"; message: string }
  | { kind: "refuse"; message: string };

export function formatMb(bytes: number): string {
  return `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`;
}

/**
 * Should this file be opened at all, and does the user deserve a heads-up
 * first? `phone` = coarse pointer / small screen, where the memory ceiling is
 * much lower.
 */
export function sizeVerdict(bytes: number, phone: boolean): SizeVerdict {
  if (bytes > HARD_LIMIT_BYTES) {
    return {
      kind: "refuse",
      message:
        `This PDF is ${formatMb(bytes)}, which is more than a browser can hold while picking sheets ` +
        `(the limit is ${formatMb(HARD_LIMIT_BYTES)}). Split the set, or re-export it from Bluebeam ` +
        `with "reduce file size" — scanned sheets are usually the weight.`,
    };
  }
  const warnAt = phone ? PHONE_WARN_BYTES : DESKTOP_WARN_BYTES;
  if (bytes > warnAt) {
    return {
      kind: "warn",
      message: phone
        ? `This PDF is ${formatMb(bytes)}. A phone may run out of memory reading a set this big — ` +
          `if the page goes blank or reloads, try it on a laptop or split the set.`
        : `This PDF is ${formatMb(bytes)}. Reading it may take a while and use a lot of memory.`,
    };
  }
  return { kind: "ok" };
}

/**
 * Race a promise against a clock. On timeout the promise is left to finish on
 * its own (nothing here can cancel it), but the caller moves on. `onTimeout`
 * is the hook for cancelling whatever can be cancelled (a pdf.js render task).
 */
export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`${label} took longer than ${Math.round(ms / 1000)} s`));
    }, ms);
  });
  return Promise.race([p, clock]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** Turn a pdf.js / pdf-lib / browser failure into a sentence Erfan can act on. */
export function explainOpenFailure(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/password|encrypted/i.test(msg))
    return "This PDF is password-protected. Remove the password (Print to PDF works) and try again.";
  if (/invalid pdf|missing pdf|header|xref|corrupt/i.test(msg))
    return "This file isn't a readable PDF — it may be damaged or not a PDF at all. Try re-exporting it.";
  if (/out of memory|allocation|array buffer allocation/i.test(msg))
    return "The browser ran out of memory reading this PDF. Try a laptop, or split the set into smaller files.";
  if (/took longer than/i.test(msg)) return msg + ". The set may be too heavy for this device.";
  return "Couldn't read this PDF: " + msg;
}
