"use client";

/**
 * "What to review" — the AI's findings.
 *  - Questions: answer inline; the answer is fed into the next Generate.
 *  - Assumptions / gaps / exclusions: an explicit decision — Accept (keep it,
 *    optionally with a note/correction) or Dismiss (leave it out) — instead of a
 *    vague checkbox. A note on an accepted finding is fed into the next Generate,
 *    so a correction (e.g. "6-inch slab, not 4") actually changes the estimate.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  answerFinding,
  setFindingStatus,
  startApplyFindings,
  getApplyRun,
  type ScopeRun,
} from "./actions";

export type Finding = {
  id: string;
  kind: string;
  text: string;
  severity: string | null;
  answer: string | null;
  resolved: boolean | null;
  status: string | null; // 'open' | 'accepted' | 'dismissed'
  options: string[] | null; // quick answer choices for a question
};

const FINDING_LABEL: Record<string, string> = {
  question: "Questions for you",
  gap: "Gaps — drawn but not scoped",
  assumption: "Assumptions to confirm",
  exclusion: "Exclusions",
};
const ORDER = ["question", "gap", "assumption", "exclusion"];

export default function FindingsReview({
  projectId,
  initialFindings,
}: {
  projectId: string;
  initialFindings: Finding[];
}) {
  const router = useRouter();
  const [findings, setFindings] = useState<Finding[]>(initialFindings);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // The "apply my responses to the scope" background job.
  const [applyRun, setApplyRun] = useState<ScopeRun | null>(null);
  const [applying, setApplying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => setFindings(initialFindings), [initialFindings]);

  const stopPolling = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    const latest = await getApplyRun(projectId);
    setApplyRun(latest);
    if (!latest || latest.status !== "running") {
      stopPolling();
      if (latest?.status === "done") router.refresh();
    }
  }, [projectId, router, stopPolling]);

  useEffect(() => {
    if (applyRun?.status === "running" && !timer.current) {
      timer.current = setInterval(poll, 2500);
    }
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyRun?.status]);

  async function onApply() {
    setApplying(true);
    setError(null);
    setApplyRun({
      id: "pending",
      status: "running",
      stage: "Starting…",
      progress: 2,
      error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const res = await startApplyFindings(projectId);
    setApplying(false);
    if (!res.ok) {
      setApplyRun({
        id: "err",
        status: "error",
        stage: null,
        progress: 0,
        error: res.error ?? "Could not apply your responses.",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return;
    }
    poll();
  }

  function patch(id: string, p: Partial<Finding>) {
    setFindings((prev) => prev.map((f) => (f.id === id ? { ...f, ...p } : f)));
  }

  function saveAnswer(id: string, answer: string) {
    const snapshot = findings;
    setError(null);
    patch(id, { answer: answer.trim() || null });
    startTransition(async () => {
      const res = await answerFinding(id, answer);
      if (!res.ok) {
        setFindings(snapshot);
        setError(res.error ?? "Could not save your answer.");
      }
    });
  }

  // Accept / dismiss a finding, optionally saving a note/correction with it.
  function decide(
    id: string,
    status: "open" | "accepted" | "dismissed",
    note?: string,
  ) {
    const snapshot = findings;
    setError(null);
    patch(id, {
      status,
      ...(note !== undefined ? { answer: note.trim() || null } : {}),
    });
    startTransition(async () => {
      if (note !== undefined) {
        const r1 = await answerFinding(id, note);
        if (!r1.ok) {
          setFindings(snapshot);
          setError(r1.error ?? "Could not save your note.");
          return;
        }
      }
      const r2 = await setFindingStatus(id, status);
      if (!r2.ok) {
        setFindings(snapshot);
        setError(r2.error ?? "Could not update the finding.");
      }
    });
  }

  if (!findings.length) return null;
  // Responses the user has made but not yet applied to the scope.
  const pendingCount = findings.filter(
    (f) =>
      !f.resolved &&
      ((f.kind === "question" && (f.answer ?? "").trim()) ||
        f.status === "accepted"),
  ).length;
  const running = applyRun?.status === "running";

  return (
    <div className="mt-8">
      <h2 className="font-heading text-lg text-foreground">What to review</h2>

      {running ? (
        <div className="mt-3 flex items-center gap-3 rounded-lg glass px-4 py-2.5 text-sm">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand" />
          <span className="text-foreground">
            {applyRun?.stage ?? "Applying your responses to the scope…"}
          </span>
        </div>
      ) : pendingCount > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg glass px-4 py-2.5">
          <span className="text-sm text-muted">
            {pendingCount} response{pendingCount > 1 ? "s" : ""} ready to apply —
            updates the scope directly, no full regenerate.
          </span>
          <button
            type="button"
            onClick={onApply}
            disabled={applying}
            className="glass-brand shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
          >
            Apply to scope
          </button>
        </div>
      ) : null}

      {applyRun?.status === "error" && applyRun.error ? (
        <p className="mt-2 rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm text-brand-soft">
          {applyRun.error}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm text-brand-soft">
          {error}
        </p>
      ) : null}

      <div className="mt-3 space-y-4">
        {ORDER.map((kind) => {
          const rows = findings.filter((f) => f.kind === kind);
          if (!rows.length) return null;
          return (
            <section key={kind} className="glass rounded-xl p-4">
              <h3 className="mb-2 text-sm uppercase tracking-wider text-muted">
                {FINDING_LABEL[kind] ?? kind}
              </h3>
              <ul className="space-y-3">
                {rows.map((f) =>
                  kind === "question" ? (
                    <QuestionRow
                      key={f.id}
                      finding={f}
                      onSave={(a) => saveAnswer(f.id, a)}
                    />
                  ) : (
                    <FindingRow
                      key={f.id}
                      finding={f}
                      onDecide={(status, note) => decide(f.id, status, note)}
                    />
                  ),
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const NOTE_CLASS =
  "w-full rounded-md border border-border bg-black/20 px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand";

function FindingRow({
  finding: f,
  onDecide,
}: {
  finding: Finding;
  onDecide: (status: "open" | "accepted" | "dismissed", note?: string) => void;
}) {
  const status = f.status ?? "open";
  const [note, setNote] = useState(f.answer ?? "");
  const [editing, setEditing] = useState(false);
  const savedNote = (f.answer ?? "").trim();

  useEffect(() => setNote(f.answer ?? ""), [f.answer]);

  // The decision form (Accept / Dismiss + note) — shown while undecided, or when
  // editing an already-accepted finding.
  const showForm = status === "open" || editing;

  if (showForm) {
    return (
      <li className="text-sm">
        <p className="text-foreground">{f.text}</p>
        <div className="mt-1.5">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note or correction (optional) — e.g. '6-inch slab, not 4'…"
            rows={2}
            className={NOTE_CLASS}
          />
          <div className="mt-1.5 flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                onDecide("accepted", note);
                setEditing(false);
              }}
              className="glass-brand rounded-md px-3 py-1 font-medium text-foreground hover:bg-brand/30"
            >
              {status === "accepted" ? "Save" : "Accept"}
            </button>
            {status === "open" ? (
              <button
                type="button"
                onClick={() => onDecide("dismissed", note)}
                className="rounded-md border border-border px-3 py-1 text-muted hover:text-foreground"
              >
                Dismiss
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNote(f.answer ?? "");
                  setEditing(false);
                }}
                className="rounded-md px-2 py-1 text-muted hover:text-foreground"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </li>
    );
  }

  if (status === "accepted") {
    return (
      <li className="text-sm">
        <p className="text-foreground">{f.text}</p>
        <div className="mt-1.5 flex items-start justify-between gap-3 rounded-md border border-green-500/20 bg-green-500/5 px-2.5 py-1.5">
          <p className="text-sm text-green-200">
            <span className="text-green-400">✓ Accepted</span>
            {savedNote ? <span className="text-green-100"> — {savedNote}</span> : null}
          </p>
          <div className="flex shrink-0 gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-muted transition-colors hover:text-foreground"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDecide("open")}
              className="text-muted transition-colors hover:text-foreground"
            >
              Undo
            </button>
          </div>
        </div>
      </li>
    );
  }

  // dismissed
  return (
    <li className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted line-through">{f.text}</span>
      <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted">
        Dismissed
        <button
          type="button"
          onClick={() => onDecide("open")}
          className="transition-colors hover:text-foreground"
        >
          Undo
        </button>
      </span>
    </li>
  );
}

function QuestionRow({
  finding: f,
  onSave,
}: {
  finding: Finding;
  onSave: (answer: string) => void;
}) {
  const saved = (f.answer ?? "").trim();
  const options = f.options ?? [];
  const [editing, setEditing] = useState(!saved);
  const [value, setValue] = useState(f.answer ?? "");
  const [typing, setTyping] = useState(false); // "Other…" free-text revealed

  // Collapse to the saved view whenever an answer lands.
  useEffect(() => {
    if (saved) {
      setEditing(false);
      setTyping(false);
    }
  }, [saved]);

  // Answered → compact confirmation with Edit.
  if (!editing) {
    return (
      <li className="text-sm">
        <p className="text-foreground">{f.text}</p>
        <div className="mt-1.5 flex items-start justify-between gap-3 rounded-md border border-green-500/20 bg-green-500/5 px-2.5 py-1.5">
          <p className="text-sm text-green-200">
            <span className="text-green-400">✓ </span>
            {saved}
          </p>
          <button
            type="button"
            onClick={() => {
              setTyping(false);
              setEditing(true);
            }}
            className="shrink-0 text-[11px] text-muted transition-colors hover:text-foreground"
          >
            Edit
          </button>
        </div>
      </li>
    );
  }

  const showChips = options.length > 0 && !typing;
  return (
    <li className="text-sm">
      <p className="text-foreground">{f.text}</p>

      {showChips ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onSave(o)}
              className="glass-brand rounded-full px-3 py-1 text-xs font-medium text-foreground hover:bg-brand/30"
            >
              {o}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setTyping(true)}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted transition-colors hover:text-foreground"
          >
            Other…
          </button>
          {saved ? (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-2 py-1 text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-1.5">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Your answer (e.g. '4-inch slab', 'walls are 9 ft')…"
            rows={2}
            className={NOTE_CLASS}
          />
          <div className="mt-1.5 flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => onSave(value)}
              disabled={!value.trim()}
              className="glass-brand rounded-md px-3 py-1 font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
            >
              Save answer
            </button>
            {options.length > 0 ? (
              <button
                type="button"
                onClick={() => setTyping(false)}
                className="rounded-md px-2 py-1 text-muted hover:text-foreground"
              >
                ← Choices
              </button>
            ) : saved ? (
              <button
                type="button"
                onClick={() => {
                  setValue(f.answer ?? "");
                  setEditing(false);
                }}
                className="rounded-md px-2 py-1 text-muted hover:text-foreground"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      )}
    </li>
  );
}
