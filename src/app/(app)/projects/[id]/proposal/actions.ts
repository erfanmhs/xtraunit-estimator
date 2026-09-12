"use server";

/**
 * Proposal actions: save the per-project fields, AI-draft the executive
 * summary, and publish / unpublish the client's share link.
 *
 * Publish freezes the current ProposalDoc onto the proposal row (public_doc)
 * and mints an unguessable share_token; the public page serves that snapshot,
 * so the client sees exactly what was sent. Re-publishing refreshes it.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient } from "@/lib/anthropic";
import { enforceAiLimit, settleAiUsage } from "@/lib/ai-usage";
import { loadProposal } from "@/lib/proposal/load";
import { log } from "@/lib/log";
import { recordAiUsage } from "@/lib/ai-meter";
import { AI_MODELS } from "@/config/ai";

const LETTER_MODEL = AI_MODELS.letter;

const optionInput = z.object({
  id: z.string().max(60),
  title: z.string().trim().max(200),
  description: z.string().trim().max(1000),
  amount: z.number().finite(),
  tier: z.enum(["recommended", "enhanced"]),
  default_on: z.boolean(),
});
const timelineInput = z.object({
  start: z.string().trim().max(200),
  duration: z.string().trim().max(200),
  milestones: z
    .array(
      z.object({
        label: z.string().trim().max(200),
        when: z.string().trim().max(200),
        depends_on: z.string().trim().max(300),
      }),
    )
    .max(40),
  assumptions: z.array(z.string().trim().max(300)).max(40),
});

// Not exported: a "use server" file may only export async functions.
const proposalPatch = z.object({
  client_name: z.string().trim().max(200).nullable().optional(),
  proposal_date: z.string().trim().max(60).nullable().optional(),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  client_brief: z.string().trim().max(5000).nullable().optional(),
  executive_summary: z.string().trim().max(5000).nullable().optional(),
  project_description: z.string().trim().max(2000).nullable().optional(),
  understanding: z.string().trim().max(5000).nullable().optional(),
  options: z.array(optionInput).max(30).optional(),
  timeline: timelineInput.optional(),
});
export type ProposalPatch = z.infer<typeof proposalPatch>;

// Columns that exist before migration 0033 (fallback when it hasn't run),
// plus the three every version of the table has.
//
// `as const` matters: it keeps these as literal key types so the fallback row
// below stays a known shape. Building it with Object.fromEntries instead
// produced a bare string index signature, which TypeScript 7 rejects when it
// is handed to a Supabase upsert.
const LEGACY_KEYS = [
  "project_id",
  "owner_id",
  "updated_at",
  "client_name",
  "proposal_date",
  "project_description",
  "understanding",
] as const;

/** Copy just the named keys, keeping each one's type. */
function pick<T extends object, K extends PropertyKey>(
  obj: T,
  keys: readonly K[],
): Pick<T, Extract<K, keyof T>> {
  const out = {} as Pick<T, Extract<K, keyof T>>;
  for (const k of keys) {
    if (k in obj) {
      const key = k as unknown as Extract<K, keyof T>;
      out[key] = obj[key];
    }
  }
  return out;
}

export async function saveProposal(
  projectId: string,
  patch: ProposalPatch,
): Promise<{ ok: boolean; error?: string; needsMigration?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const parsed = proposalPatch.safeParse(patch);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const row = {
    project_id: projectId,
    owner_id: user.id,
    ...parsed.data,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("proposals")
    .upsert(row, { onConflict: "project_id" });
  if (!error) return { ok: true };

  // Migration 0033 not run yet → save what the older table can hold.
  const legacy = pick(row, LEGACY_KEYS);
  const retry = await supabase.from("proposals").upsert(legacy, { onConflict: "project_id" });
  if (retry.error)
    return { ok: false, error: "Could not save. (Has migration 0017 been run in Supabase?)" };
  return {
    ok: true,
    needsMigration: true,
    error:
      "Saved the basics. The executive summary, options, timeline and expiry need migration 0033 — run it in Supabase, then save again.",
  };
}

export type ProposalNarrative = {
  executive_summary: string;
  project_description: string;
};

/**
 * AI-draft the tailored opening: the client's own goal/constraint (from the
 * brief they gave us + project notes + their answers to our questions), our
 * approach, and why it fits THIS job. Under 300 words, no company boilerplate.
 */
export async function draftProposalNarrative(
  projectId: string,
  clientBrief: string,
): Promise<{ ok: boolean; narrative?: ProposalNarrative; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const limit = await enforceAiLimit(supabase, user.id, "proposal");
  if (!limit.ok) return { ok: false, error: limit.error };

  const { doc } = await loadProposal(supabase, projectId);
  if (!doc) return { ok: false, error: "Project not found." };
  const { data: project } = await supabase
    .from("projects")
    .select("notes")
    .eq("id", projectId)
    .maybeSingle();

  // The client's answers to the AI's questions — their words about the job.
  const qa = await supabase
    .from("scope_findings")
    .select("text,answer")
    .eq("project_id", projectId)
    .eq("kind", "question")
    .not("answer", "is", null);
  const answers = (qa.data ?? [])
    .filter((r) => (r.answer ?? "").trim())
    .map((r) => `Q: ${r.text}\nA: ${r.answer}`)
    .join("\n");

  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const trades = doc.scope.divisions.map((d) => d.name).join(", ");

  const prompt = `Write the EXECUTIVE SUMMARY for a construction bid proposal from ${doc.company.company_name ?? "XtraUnit Construction"} (${doc.company.company_license ?? "CA LIC #1033830"}), a licensed California general contractor, to ${doc.client_name}.

PROJECT: ${doc.project.name}${doc.project.project_type ? ` — ${doc.project.project_type}` : ""} at ${doc.project.address ?? "the project address"}.${doc.project.building_sf ? ` About ${doc.project.building_sf.toLocaleString()} SF.` : ""}
BID: ${usd.format(doc.pricing.total)}${doc.pricing.psf ? ` (about $${Math.round(doc.pricing.psf)}/SF)` : ""}.
TRADES COVERED: ${trades || "per the attached scope"}.
${clientBrief.trim() ? `WHAT THE CLIENT TOLD US (their words — reflect these back, do not invent):\n${clientBrief.trim()}` : "WHAT THE CLIENT TOLD US: (nothing recorded — infer the likely goal from the project type and notes, and keep it modest)"}
${project?.notes ? `PROJECT NOTES: ${project.notes}` : ""}
${answers ? `THE CLIENT'S ANSWERS TO OUR QUESTIONS:\n${answers}` : ""}
${doc.scope.assumptions.length ? `KEY ASSUMPTIONS: ${doc.scope.assumptions.slice(0, 5).join("; ")}` : ""}

Rules:
- UNDER 300 WORDS. Three short paragraphs: (1) the client's specific goal or constraint, in their own words where we have them; (2) our approach to THIS job — the two or three things that matter most here (site, phasing, agencies, occupied building, budget target, schedule); (3) why we fit this particular job. No company history, no "we are pleased to submit", no clichés, no markdown, no bullet lists.
- Plain, confident, specific. Never state the dollar amount (the Pricing section shows it).

Also return project_description: one or two plain sentences describing what is being built (use the project type given).

Return JSON: { "executive_summary": string, "project_description": string }.`;

  try {
    const client = getAnthropicClient();
    const stream = client.beta.messages.stream({
      model: LETTER_MODEL,
      max_tokens: 1500,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              executive_summary: { type: "string" },
              project_description: { type: "string" },
            },
            required: ["executive_summary", "project_description"],
          },
        },
      },
      messages: [{ role: "user", content: prompt }],
    });
    const msg = await stream.finalMessage();
    await settleAiUsage(supabase, limit.usageId, recordAiUsage(LETTER_MODEL, msg.usage, "proposal"));
    const textBlock = msg.content.find((b) => b.type === "text");
    const text = textBlock && "text" in textBlock ? (textBlock.text as string) : "";
    if (!text) return { ok: false, error: "The AI returned nothing — try again." };
    return { ok: true, narrative: JSON.parse(text) as ProposalNarrative };
  } catch (e) {
    log.error("proposal.narrative.failed", { projectId, userId: user.id, err: e });
    return { ok: false, error: "Could not draft the summary — try again." };
  }
}

/** Publish (or refresh) the client's share link: snapshot the doc + mint a token. */
export async function publishProposal(
  projectId: string,
): Promise<{ ok: boolean; token?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { doc, meta } = await loadProposal(supabase, projectId);
  if (!doc) return { ok: false, error: "Project not found." };
  if (!meta.hasShareColumns)
    return {
      ok: false,
      error: "Share links need migration 0033 — run it in Supabase first (see PENDING-DB-CHANGES.md).",
    };

  const token = meta.share_token ?? randomBytes(24).toString("base64url");
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("proposals")
    .upsert(
      {
        project_id: projectId,
        owner_id: user.id,
        share_token: token,
        public_doc: { ...doc, published_at: now },
        published_at: now,
        updated_at: now,
      },
      { onConflict: "project_id" },
    );
  if (error) return { ok: false, error: "Could not publish. Try again." };
  return { ok: true, token };
}

/** Turn the share link off (keeps the token so re-publishing restores the same URL). */
export async function unpublishProposal(projectId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const { error } = await supabase
    .from("proposals")
    .update({ public_doc: null, updated_at: new Date().toISOString() })
    .eq("project_id", projectId);
  if (error) return { ok: false, error: "Could not turn the link off." };
  return { ok: true };
}
