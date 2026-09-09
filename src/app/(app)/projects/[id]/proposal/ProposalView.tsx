"use client";

/**
 * The owner's proposal workbench: an editor for the project-specific parts
 * (executive summary, options, timeline, expiry) above a live preview of the
 * exact page the client will open, plus the share-link controls.
 *
 * Everything else on the page (scope, pricing, terms, references) is assembled
 * from the project's data and the company profile — nothing to retype.
 */
import { useMemo, useState, useTransition } from "react";
import ProposalDocument from "@/components/proposal/ProposalDocument";
import {
  cleanOptions,
  cleanTimeline,
  plusDays,
  type ProposalDoc,
  type ProposalOption,
  type ProposalTimeline,
} from "@/lib/proposal/model";
import type { ProposalMeta } from "@/lib/proposal/load";
import {
  saveProposal,
  draftProposalNarrative,
  publishProposal,
  unpublishProposal,
} from "./actions";

const FIELD =
  "w-full rounded-md border border-border bg-black/20 px-2 py-1.5 text-sm text-foreground outline-none focus:border-brand";
const LABEL = "text-[11px] uppercase tracking-wider text-muted";

function newId() {
  return `opt-${Math.random().toString(36).slice(2, 8)}`;
}

export default function ProposalView({
  projectId,
  doc: base,
  meta,
}: {
  projectId: string;
  doc: ProposalDoc;
  meta: ProposalMeta;
}) {
  // Editable fields (seeded from the saved proposal / the live doc).
  const [clientName, setClientName] = useState(base.client_name);
  const [proposalDate, setProposalDate] = useState(base.proposal_date);
  const [validUntil, setValidUntil] = useState(base.valid_until ?? plusDays(new Date(), 30));
  const [brief, setBrief] = useState(meta.client_brief);
  const [summary, setSummary] = useState(base.executive_summary);
  const [description, setDescription] = useState(base.project_description);
  const [options, setOptions] = useState<ProposalOption[]>(base.pricing.options);
  const [timeline, setTimeline] = useState<ProposalTimeline>(base.timeline);

  const [editing, setEditing] = useState(!base.executive_summary);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(meta.share_token);
  const [published, setPublished] = useState<boolean>(!!meta.published_at);
  const [, start] = useTransition();

  // The preview = the live doc with the edits laid over it.
  const doc: ProposalDoc = useMemo(
    () => ({
      ...base,
      client_name: clientName || base.client_name,
      proposal_date: proposalDate || base.proposal_date,
      valid_until: validUntil || null,
      executive_summary: summary,
      project_description: description,
      pricing: { ...base.pricing, options: cleanOptions(options) },
      timeline: cleanTimeline(timeline),
    }),
    [base, clientName, proposalDate, validUntil, summary, description, options, timeline],
  );

  const shareUrl =
    shareToken && typeof window !== "undefined"
      ? `${window.location.origin}/p/${shareToken}`
      : null;

  function patch() {
    return {
      client_name: clientName.trim() || null,
      proposal_date: proposalDate.trim() || null,
      valid_until: validUntil || null,
      client_brief: brief.trim() || null,
      executive_summary: summary.trim() || null,
      project_description: description.trim() || null,
      options: cleanOptions(options),
      timeline: cleanTimeline(timeline),
    };
  }

  function onSave(then?: () => void) {
    setError(null);
    setNotice(null);
    setBusy("Saving…");
    start(async () => {
      const res = await saveProposal(projectId, patch());
      setBusy(null);
      if (!res.ok) return setError(res.error ?? "Could not save.");
      setNotice(res.needsMigration ? (res.error ?? "Saved.") : "Saved ✓");
      then?.();
    });
  }

  function onDraft() {
    setError(null);
    setBusy("AI is drafting the executive summary…");
    start(async () => {
      // Save the brief first so the AI reads the latest version of it.
      await saveProposal(projectId, { client_brief: brief.trim() || null });
      const res = await draftProposalNarrative(projectId, brief);
      setBusy(null);
      if (!res.ok || !res.narrative) return setError(res.error ?? "Draft failed.");
      setSummary(res.narrative.executive_summary);
      if (!description.trim()) setDescription(res.narrative.project_description);
      setEditing(true);
    });
  }

  function onPublish() {
    // Save first so the snapshot is what's on screen, then publish.
    onSave(() => {
      setBusy(published ? "Updating the link…" : "Publishing…");
      start(async () => {
        const res = await publishProposal(projectId);
        setBusy(null);
        if (!res.ok || !res.token) return setError(res.error ?? "Could not publish.");
        setShareToken(res.token);
        setPublished(true);
        setNotice(published ? "Link updated with the latest proposal ✓" : "Link is live ✓");
      });
    });
  }

  function onUnpublish() {
    if (!window.confirm("Turn the client's link off? They'll see 'not active' until you publish again."))
      return;
    setBusy("Turning the link off…");
    start(async () => {
      const res = await unpublishProposal(projectId);
      setBusy(null);
      if (!res.ok) return setError(res.error ?? "Could not turn the link off.");
      setPublished(false);
      setNotice("Link is off.");
    });
  }

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setNotice("Link copied ✓");
    } catch {
      setNotice(shareUrl);
    }
  }

  // ── option / timeline row helpers ─────────────────────────────────────────
  const setOpt = (id: string, p: Partial<ProposalOption>) =>
    setOptions((xs) => xs.map((o) => (o.id === id ? { ...o, ...p } : o)));
  const setMs = (i: number, p: Partial<ProposalTimeline["milestones"][number]>) =>
    setTimeline((t) => ({
      ...t,
      milestones: t.milestones.map((m, j) => (j === i ? { ...m, ...p } : m)),
    }));

  return (
    <div className="mt-6">
      {/* Controls (never printed) */}
      <div className="print-hide mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className={`rounded-md border px-3 py-2 text-sm transition-colors ${
            editing ? "border-brand bg-brand/20 text-foreground" : "border-border text-muted hover:border-brand hover:text-foreground"
          }`}
        >
          {editing ? "Hide editor" : "Edit"}
        </button>
        <button
          type="button"
          onClick={() => onSave()}
          disabled={!!busy}
          className="rounded-md border border-border px-3 py-2 text-sm text-muted transition-colors hover:border-brand hover:text-foreground disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onPublish}
          disabled={!!busy || !meta.hasShareColumns}
          title={meta.hasShareColumns ? "" : "Needs migration 0033 (see PENDING-DB-CHANGES.md)"}
          className="glass-brand rounded-lg px-4 py-2 text-sm font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
        >
          {published ? "Update client link" : "Publish client link"}
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md border border-border px-3 py-2 text-sm text-muted transition-colors hover:border-brand hover:text-foreground"
        >
          Print / PDF
        </button>
        {busy ? <span className="animate-pulse text-sm text-muted">{busy}</span> : null}
        {notice ? <span className="text-sm text-green-300">{notice}</span> : null}
        {error ? <span className="text-sm text-brand-soft">{error}</span> : null}
      </div>

      {/* Share status */}
      <div className="print-hide mb-4 rounded-xl glass p-4 text-sm">
        {!meta.hasShareColumns ? (
          <p className="text-muted">
            The client link (and Accept-in-document) switches on once migration{" "}
            <span className="text-foreground">0033_proposal_redesign.sql</span> is run in Supabase.
            Until then this page still previews and prints.
          </p>
        ) : published && shareUrl ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-wider text-muted">Client link · live</p>
              <p className="truncate font-mono text-xs text-foreground" title={shareUrl}>
                {shareUrl}
              </p>
              {meta.accepted_at ? (
                <p className="mt-1 text-green-300">
                  ✓ Accepted by {meta.accepted_by?.name ?? "the client"} on{" "}
                  {new Date(meta.accepted_at).toLocaleDateString()}
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted">
                  Opens on any device, no login. Edit here and click &ldquo;Update client link&rdquo; to refresh what they see.
                </p>
              )}
            </div>
            <button type="button" onClick={copyLink} className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:border-brand">
              Copy link
            </button>
            <a href={shareUrl} target="_blank" rel="noreferrer" className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:border-brand">
              Open ↗
            </a>
            <button type="button" onClick={onUnpublish} className="text-xs text-muted hover:text-brand-soft">
              Turn off
            </button>
          </div>
        ) : (
          <p className="text-muted">
            Not shared yet. <span className="text-foreground">Publish client link</span> creates a private,
            unguessable link the client opens on any device — with live option toggles and Accept built in.
            The PDF is the fallback.
          </p>
        )}
      </div>

      {/* Editor */}
      {editing ? (
        <div className="print-hide mb-6 space-y-5 rounded-xl panel p-4 sm:p-5">
          <p className="text-[11px] uppercase tracking-wider text-muted">
            Editing — only you see this
          </p>
          {/* Addressing + expiry */}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Prepared for</span>
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} className={FIELD} spellCheck />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Proposal date (as shown)</span>
              <input value={proposalDate} onChange={(e) => setProposalDate(e.target.value)} className={FIELD} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Pricing valid through</span>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={FIELD} />
            </label>
          </div>

          {/* Executive summary */}
          <div>
            <span className={LABEL}>01 · Executive summary</span>
            <p className="mt-0.5 text-xs text-muted">
              First, what did the client tell you they need or worry about — in their words? The AI turns
              that into a tight, tailored summary (under 300 words).
            </p>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={3}
              spellCheck
              placeholder="e.g. “We need to stay open during construction and the budget can't go past $500k. The city has been slow on permits.”"
              className={`${FIELD} mt-2`}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onDraft}
                disabled={!!busy}
                className="glass-brand rounded-md px-3 py-1.5 text-xs font-medium text-foreground hover:bg-brand/30 disabled:opacity-50"
              >
                {summary ? "Re-draft summary with AI" : "Draft summary with AI"}
              </button>
              <span className="text-xs text-muted">{summary.trim().split(/\s+/).filter(Boolean).length} words</span>
            </div>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={7}
              spellCheck
              placeholder="The executive summary — or let the AI draft it from the brief above."
              className={`${FIELD} mt-2`}
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              spellCheck
              placeholder="One-line project description (what's being built)"
              className={`${FIELD} mt-2`}
            />
          </div>

          {/* Options */}
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className={LABEL}>03 · Tiered options (on top of the base bid)</span>
              <button
                type="button"
                onClick={() =>
                  setOptions((xs) => [
                    ...xs,
                    { id: newId(), title: "", description: "", amount: 0, tier: "recommended", default_on: false },
                  ])
                }
                className="text-xs text-brand-soft hover:underline"
              >
                + Add option
              </button>
            </div>
            <p className="mt-0.5 text-xs text-muted">
              &ldquo;Recommended&rdquo; options make the Recommended package; &ldquo;Enhanced&rdquo; ones are on top of that. The client
              toggles them and the total updates live. Leave empty for a single fixed price.
            </p>
            {options.length ? (
              <div className="mt-2 space-y-2">
                {options.map((o) => (
                  <div key={o.id} className="grid gap-1.5 rounded-lg border border-border p-2 sm:grid-cols-[1fr_7rem_8.5rem_auto_auto]">
                    <input value={o.title} onChange={(e) => setOpt(o.id, { title: e.target.value })} placeholder="Option title" spellCheck className={FIELD} />
                    <input
                      value={o.amount || ""}
                      onChange={(e) => setOpt(o.id, { amount: Number(e.target.value) || 0 })}
                      inputMode="decimal"
                      placeholder="+ $"
                      className={`${FIELD} text-right`}
                    />
                    <select value={o.tier} onChange={(e) => setOpt(o.id, { tier: e.target.value as ProposalOption["tier"] })} className={FIELD}>
                      <option value="recommended">Recommended</option>
                      <option value="enhanced">Enhanced</option>
                    </select>
                    <label className="flex items-center gap-1.5 text-xs text-muted">
                      <input type="checkbox" checked={o.default_on} onChange={(e) => setOpt(o.id, { default_on: e.target.checked })} />
                      On by default
                    </label>
                    <button type="button" onClick={() => setOptions((xs) => xs.filter((x) => x.id !== o.id))} className="text-xs text-muted hover:text-brand-soft">
                      Remove
                    </button>
                    <input
                      value={o.description}
                      onChange={(e) => setOpt(o.id, { description: e.target.value })}
                      placeholder="What it includes (one line)"
                      spellCheck
                      className={`${FIELD} sm:col-span-5`}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Timeline */}
          <div>
            <span className={LABEL}>04 · Timeline</span>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <input value={timeline.start} onChange={(e) => setTimeline((t) => ({ ...t, start: e.target.value }))} placeholder="Anticipated start (e.g. within 2 weeks of permit)" className={FIELD} />
              <input value={timeline.duration} onChange={(e) => setTimeline((t) => ({ ...t, duration: e.target.value }))} placeholder="Duration (e.g. 18–21 months)" className={FIELD} />
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-xs text-muted">Milestones — the hard dates, each with what it depends on</span>
              <button
                type="button"
                onClick={() => setTimeline((t) => ({ ...t, milestones: [...t.milestones, { label: "", when: "", depends_on: "" }] }))}
                className="text-xs text-brand-soft hover:underline"
              >
                + Add milestone
              </button>
            </div>
            {timeline.milestones.length ? (
              <div className="mt-1.5 space-y-1.5">
                {timeline.milestones.map((m, i) => (
                  <div key={i} className="grid gap-1.5 sm:grid-cols-[1fr_9rem_1fr_auto]">
                    <input value={m.label} onChange={(e) => setMs(i, { label: e.target.value })} placeholder="Milestone (e.g. Permits issued)" spellCheck className={FIELD} />
                    <input value={m.when} onChange={(e) => setMs(i, { when: e.target.value })} placeholder="When (Week 3)" className={FIELD} />
                    <input value={m.depends_on} onChange={(e) => setMs(i, { depends_on: e.target.value })} placeholder="Depends on (owner selections by…)" spellCheck className={FIELD} />
                    <button type="button" onClick={() => setTimeline((t) => ({ ...t, milestones: t.milestones.filter((_, j) => j !== i) }))} className="text-xs text-muted hover:text-brand-soft">
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <textarea
              value={timeline.assumptions.join("\n")}
              onChange={(e) => setTimeline((t) => ({ ...t, assumptions: e.target.value.split("\n") }))}
              rows={3}
              spellCheck
              placeholder={"Dependencies & assumptions on the critical path — one per line, e.g.\nPermit issuance by the city\nOwner's finish selections by week 2\nSite access Mon–Sat 7am–5pm"}
              className={`${FIELD} mt-2`}
            />
          </div>

          <p className="text-xs text-muted">
            Scope, pricing breakdown, terms, and references come from the project and your Settings → Proposal profile.
          </p>
        </div>
      ) : null}

      {/*
        F1 - a clear line between the editor above and the document below.
        They ran straight into each other, so it was not obvious where your
        controls stopped and the client's document started - and this page
        prints, which makes that distinction matter.

        The rule carries a label, and it is print-hidden so none of it reaches
        the paper.
      */}
      <div className="print-hide mb-4 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] uppercase tracking-wider text-muted">
          What the client sees
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* The proposal, exactly as the client sees it */}
      <ProposalDocument
        doc={doc}
        mode="preview"
        accepted={meta.accepted_at ? { name: meta.accepted_by?.name ?? "the client", at: meta.accepted_at } : null}
      />
    </div>
  );
}
