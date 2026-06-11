"use client";

/**
 * "What to review" — the AI's findings. Questions can be answered inline; the
 * answer is saved and fed into the next Generate (the AI treats it as
 * authoritative and won't re-ask it). Gaps / assumptions / exclusions can be
 * checked off (resolved) once you've dealt with them.
 */
import { useEffect, useState, useTransition } from "react";
import { answerFinding, setFindingResolved } from "./actions";

export type Finding = {
  id: string;
  kind: string;
  text: string;
  severity: string | null;
  answer: string | null;
  resolved: boolean | null;
};

const FINDING_LABEL: Record<string, string> = {
  question: "Questions for you",
  gap: "Gaps — drawn but not scoped",
  assumption: "Assumptions to confirm",
  exclusion: "Exclusions",
};
const ORDER = ["question", "gap", "assumption", "exclusion"];

export default function FindingsReview({
  initialFindings,
}: {
  initialFindings: Finding[];
}) {
  const [findings, setFindings] = useState<Finding[]>(initialFindings);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => setFindings(initialFindings), [initialFindings]);

  function patch(id: string, p: Partial<Finding>) {
    setFindings((prev) => prev.map((f) => (f.id === id ? { ...f, ...p } : f)));
  }

  function saveAnswer(id: string, answer: string) {
    const snapshot = findings;
    setError(null);
    patch(id, { answer: answer.trim() || null, resolved: !!answer.trim() });
    startTransition(async () => {
      const res = await answerFinding(id, answer);
      if (!res.ok) {
        setFindings(snapshot);
        setError(res.error ?? "Could not save your answer.");
      }
    });
  }

  function toggleResolved(id: string, resolved: boolean) {
    const snapshot = findings;
    setError(null);
    patch(id, { resolved });
    startTransition(async () => {
      const res = await setFindingResolved(id, resolved);
      if (!res.ok) {
        setFindings(snapshot);
        setError(res.error ?? "Could not update the finding.");
      }
    });
  }

  if (!findings.length) return null;
  const answeredCount = findings.filter(
    (f) => f.kind === "question" && (f.answer ?? "").trim(),
  ).length;

  return (
    <div className="mt-8">
      <h2 className="font-heading text-lg text-foreground">What to review</h2>
      {answeredCount > 0 ? (
        <p className="mt-1 text-xs text-muted">
          {answeredCount} answer{answeredCount > 1 ? "s" : ""} saved — they&apos;ll
          be used the next time you Generate.
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
                      onToggle={(r) => toggleResolved(f.id, r)}
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

function FindingRow({
  finding: f,
  onToggle,
}: {
  finding: Finding;
  onToggle: (resolved: boolean) => void;
}) {
  const resolved = !!f.resolved;
  return (
    <li className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={resolved}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-1 h-3.5 w-3.5 shrink-0 accent-brand"
      />
      <span className={resolved ? "text-muted line-through" : "text-foreground"}>
        {f.text}
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
  const [editing, setEditing] = useState(!saved);
  const [value, setValue] = useState(f.answer ?? "");

  // Collapse to the saved view whenever an answer lands.
  useEffect(() => {
    if (saved) setEditing(false);
  }, [saved]);

  return (
    <li className="text-sm">
      <p className="text-foreground">{f.text}</p>

      {editing ? (
        <div className="mt-1.5">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Your answer (e.g. '4-inch slab', 'walls are 9 ft', 'demo is in scope')…"
            rows={2}
            className="w-full rounded-md border border-border bg-black/20 px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand"
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
            {saved ? (
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
      ) : (
        <div className="mt-1.5 flex items-start justify-between gap-3 rounded-md border border-green-500/20 bg-green-500/5 px-2.5 py-1.5">
          <p className="text-sm text-green-200">
            <span className="text-green-400">✓ </span>
            {saved}
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 text-[11px] text-muted transition-colors hover:text-foreground"
          >
            Edit
          </button>
        </div>
      )}
    </li>
  );
}
