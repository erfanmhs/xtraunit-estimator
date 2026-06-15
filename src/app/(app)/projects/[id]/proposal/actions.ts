"use server";

/**
 * Phase 11 — Proposal actions: AI-draft the cover letter, save edits.
 * The letter is the only stored text; cost table + assumptions/exclusions are
 * assembled live so they always match the current estimate.
 */
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient } from "@/lib/anthropic";

import { AI_MODELS } from "@/config/ai";

const LETTER_MODEL = AI_MODELS.letter;

export async function saveProposal(
  projectId: string,
  patch: {
    letter_text?: string | null;
    client_name?: string | null;
    proposal_date?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.from("proposals").upsert(
    {
      project_id: projectId,
      owner_id: user.id,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" },
  );
  if (error)
    return {
      ok: false,
      error:
        "Could not save. (Has migration 0017 been run in Supabase?)",
    };
  return { ok: true };
}

/** AI-draft the cover letter from the project + estimate. Returns the text —
 *  the user edits/saves it; nothing is sent anywhere. */
export async function draftLetter(
  projectId: string,
  grandTotal: number,
  divisionSummary: string,
): Promise<{ ok: boolean; letter?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: project } = await supabase
    .from("projects")
    .select("name,client_name,address,project_type,notes")
    .eq("id", projectId)
    .maybeSingle();
  const { data: cs } = await supabase
    .from("company_settings")
    .select("company_name,company_license")
    .maybeSingle();

  const usd = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  const prompt = `Write the cover letter body for a construction bid proposal. Plain professional language a busy owner reads in one minute — no flowery filler, no "we are pleased to submit" clichés stacked on each other, no markdown.

From: ${cs?.company_name ?? "XtraUnit Construction"} (${cs?.company_license ?? "CA LIC #1033830"}), a licensed California general contractor.
To: ${project?.client_name ?? "the Owner"}.
Project: ${project?.name ?? "the project"}${project?.project_type ? ` — ${project.project_type}` : ""} at ${project?.address ?? "the project address"}.
Bid amount (use this exact number once): ${usd.format(grandTotal)}.
Trades covered: ${divisionSummary}.

Structure: a short opening stating what is being proposed and for how much; one paragraph on scope coverage (reference the attached cost breakdown by CSI division rather than re-listing everything); one short paragraph on what makes the number reliable (takeoffs from the plans, trade-partner quotes where applicable); close with validity (30 days), and an invitation to discuss. End with "Respectfully," and NOTHING after it — no name, no company (the template adds the signature block). 150-220 words. Letter body only — no date, no addresses (the template adds those).`;

  try {
    const client = getAnthropicClient();
    const stream = client.beta.messages.stream({
      model: LETTER_MODEL,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });
    const msg = await stream.finalMessage();
    const textBlock = msg.content.find((b) => b.type === "text");
    const letter =
      textBlock && "text" in textBlock ? (textBlock.text as string).trim() : "";
    if (!letter) return { ok: false, error: "The AI returned nothing — try again." };
    return { ok: true, letter };
  } catch {
    return { ok: false, error: "Could not draft the letter — try again." };
  }
}
