"use client";

/**
 * "What to review" — the AI's findings, as one-line rows with chips.
 *  - Questions: one-tap answer chips (or type your own); the answer feeds the
 *    next Generate / Apply.
 *  - Assumptions / gaps / exclusions: one line each with three chips —
 *    ✓ Accept · ✕ Dismiss · + Note. Chips toggle (tap again to undo). A note
 *    is a correction ("6-inch slab, not 4") and counts as an accept, so it's
 *    applied to the scope. "Accept all" clears a section in one tap.
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
  question: "Questions",
  gap: "Gaps",
  assumption: "Assumptions",
  exclusion: "Exclusions",
};
const FINDING_HINT: Record<string, string> = {
  question: "One tap answers; they feed the next generate.",
  gap: "Drawn on the plans but not in the scope yet.",
  assumption: "What the price relies on — accept, or correct it with a note.",
  exclusion: "Left out of the price on purpose.",
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
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

  // One tap for a whole section: accept every still-open finding of a kind.
  function acceptAll(kind: string) {
    const ids = findings
      .filter((f) => f.kind === kind && (f.status ?? "open") === "open")
      .map((f) => f.id);
    if (!ids.length) return;
    const snapshot = findings;
    setError(null);
    setFindings((prev) =>
      prev.map((f) => (ids.includes(f.id) ? { ...f, status: "accepted" } : f)),
    );
    startTransition(async () => {
      const results = await Promise.all(ids.map((id) => setFindingStatus(id, "accepted")));
      if (results.some((r) => !r.ok)) {
        setFindings(snapshot);
        setError("Could not accept every item — try again.");
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
          const open =
            kind === "question"
              ? rows.filter((f) => !(f.answer ?? "").trim()).length
              : rows.filter((f) => (f.status ?? "open") === "open").length;
          return (
            <section key={kind} className="glass rounded-xl p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((c) => ({ ...c, [kind]: !c[kind] }))
                  }
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-expanded={!collapsed[kind]}
                >
                  <span className="text-xs text-muted">{collapsed[kind] ? "▸" : "▾"}</span>
                  <h3 className="text-sm uppercase tracking-wider text-muted">
                    {FINDING_LABEL[kind] ?? kind}
                  </h3>
                  <span className="text-[11px] text-muted/70">
                    {open > 0 ? `${open} open` : "all decided"}
                    {open > 0 && open < rows.length ? ` · ${rows.length - open} done` : ""}
                  </span>
                </button>
                {kind !== "question" && open > 0 && !collapsed[kind] ? (
                  <button
                    type="button"
                    onClick={() => acceptAll(kind)}
                    className="rounded-full border border-green-500/40 bg-green-500/10 px-2.5 py-0.5 text-[11px] text-green-300 transition-colors hover:bg-green-500/20"
                  >
                    ✓ Accept all {open > 1 ? `(${open})` : ""}
                  </button>
                ) : null}
              </div>
              {!collapsed[kind] ? (
                <>
                <p className="mt-0.5 text-[11px] text-muted/60">{FINDING_HINT[kind]}</p>
                <ul className="mt-2 divide-y divide-border">
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
                </>
              ) : null}
            </section>
          );
        })}
      </div>

      {/*
        The apply bar lives BELOW the list, because you apply your answers
        after you have read and answered them — not before. It used to sit in
        the header, above everything it acts on. Sticky so it stays in reach
        while working down a long list of questions.
      */}
      {!running && pendingCount > 0 ? (
        <div className="sticky bottom-0 z-10 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface/95 px-4 py-2.5 backdrop-blur pb-safe">
          <span className="text-sm text-muted">
            {pendingCount} response{pendingCount > 1 ? "s" : ""} ready to apply —
            updates the scope directly, no full regenerate.
          </span>
          <button
            type="button"
            onClick={onApply}
            disabled={applying}
            className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong disabled:opacity-50"
          >
            {applying ? "Applying…" : "Apply to Scope"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

const NOTE_CLASS =
  "w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand";

/** A toggle chip. `on` = selected state; tapping again is the undo. */
function Chip({
  on,
  tone,
  onClick,
  children,
  title,
}: {
  on?: boolean;
  tone: "green" | "muted" | "plain";
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  const base = "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors";
  const look = on
    ? tone === "green"
      ? "border-green-500/50 bg-green-500/15 text-green-300"
      : "border-border bg-white/10 text-foreground"
    : tone === "green"
      ? "border-border text-muted hover:border-green-500/50 hover:text-green-300"
      : "border-border text-muted hover:border-brand hover:text-foreground";
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={on} className={`${base} ${look}`}>
      {children}
    </button>
  );
}

function FindingRow({
  finding: f,
  onDecide,
}: {
  finding: Finding;
  onDecide: (status: "open" | "accepted" | "dismissed", note?: string) => void;
}) {
  const status = f.status ?? "open";
  const accepted = status === "accepted";
  const dismissed = status === "dismissed";
  const savedNote = (f.answer ?? "").trim();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(f.answer ?? "");

  useEffect(() => setNote(f.answer ?? ""), [f.answer]);

  function saveNote() {
    // A note is a correction, so it counts as accepting the (corrected) item.
    onDecide("accepted", note);
    setNoteOpen(false);
  }

  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1.5 py-2 text-sm">
      <p
        className={`min-w-0 flex-1 basis-56 leading-snug ${
          dismissed ? "text-muted/70 line-through" : "text-foreground"
        }`}
      >
        {f.text}
        {accepted && savedNote && !noteOpen ? (
          <span className="text-green-200"> — {savedNote}</span>
        ) : null}
      </p>
      <div className="flex shrink-0 items-center gap-1">
        <Chip
          on={accepted}
          tone="green"
          onClick={() => onDecide(accepted ? "open" : "accepted")}
          title={accepted ? "Tap to undo" : "Keep this in the estimate"}
        >
          {accepted ? "✓ Accepted" : "✓ Accept"}
        </Chip>
        <Chip
          on={dismissed}
          tone="muted"
          onClick={() => onDecide(dismissed ? "open" : "dismissed")}
          title={dismissed ? "Tap to undo" : "Leave this out"}
        >
          {dismissed ? "Dismissed" : "✕ Dismiss"}
        </Chip>
        <Chip
          on={noteOpen}
          tone="plain"
          onClick={() => setNoteOpen((o) => !o)}
          title="Add a correction, e.g. 6-inch slab, not 4"
        >
          {savedNote ? "✎ Note" : "+ Note"}
        </Chip>
      </div>
      {noteOpen ? (
        <div className="flex basis-full items-center gap-2">
          <input
            value={note}
            autoFocus
            spellCheck
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveNote();
              if (e.key === "Escape") {
                setNote(f.answer ?? "");
                setNoteOpen(false);
              }
            }}
            placeholder="Correction or note — e.g. '6-inch slab, not 4' — Enter to save"
            className={NOTE_CLASS}
          />
          <button
            type="button"
            onClick={saveNote}
            className="glass-brand shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-foreground hover:bg-brand/30"
          >
            Save
          </button>
        </div>
      ) : null}
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

  // Answered → one line: the question, the answer as a green chip, Edit.
  if (!editing) {
    return (
      <li className="flex flex-wrap items-start gap-x-3 gap-y-1.5 py-2 text-sm">
        <p className="min-w-0 flex-1 basis-56 leading-snug text-foreground">{f.text}</p>
        <div className="flex shrink-0 items-center gap-1">
          <span className="rounded-full border border-green-500/50 bg-green-500/15 px-2.5 py-0.5 text-[11px] text-green-300">
            ✓ {saved}
          </span>
          <button
            type="button"
            onClick={() => {
              setTyping(false);
              setEditing(true);
            }}
            className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted transition-colors hover:text-foreground"
          >
            Edit
          </button>
        </div>
      </li>
    );
  }

  const showChips = options.length > 0 && !typing;
  return (
    <li className="py-2 text-sm">
      <p className="leading-snug text-foreground">{f.text}</p>

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
            spellCheck
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
