/**
 * Web Worker wrapper around findAll — the search takes a second or two on a
 * big sheet, and the viewer's main thread must keep the sheet pannable.
 */
import { findAll, type Gray, type Match, type MatchOptions } from "./templateMatch";

export type WorkerIn = { source: Gray; template: Gray; opts?: MatchOptions };
export type WorkerOut = { matches: Match[] } | { error: string };

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  try {
    const { source, template, opts } = e.data;
    const matches = findAll(source, template, opts);
    (self as unknown as Worker).postMessage({ matches } satisfies WorkerOut);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerOut);
  }
};
