"use server";

/**
 * Company settings: identity (proposal letterhead) + default markups
 * (pre-fill every new project's Estimate). One row per user, upserted.
 */
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient } from "@/lib/anthropic";
import { AI_MODELS } from "@/config/ai";
import {
  DEFAULT_PROFILE,
  type ProposalProfile,
} from "@/lib/proposal/profile";

// Note: $/SF benchmarks and standard unit prices also live on company_settings
// but are edited under the Cost Database tab (see cost-database/actions.ts) —
// they're cost knowledge, not company settings.
export type CompanySettings = {
  company_name: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_email: string | null;
  company_license: string | null;
  signer_name: string | null;
  signer_title: string | null;
  default_contingency_pct: number;
  default_insurance_pct: number;
  default_op_pct: number;
};

export async function saveCompanySettings(
  settings: CompanySettings,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  for (const k of [
    "default_contingency_pct",
    "default_insurance_pct",
    "default_op_pct",
  ] as const) {
    const v = settings[k];
    if (!Number.isFinite(v) || v < 0 || v > 100)
      return { ok: false, error: "Markups must be between 0 and 100 percent." };
  }

  const { error } = await supabase.from("company_settings").upsert(
    { owner_id: user.id, ...settings, updated_at: new Date().toISOString() },
    { onConflict: "owner_id" },
  );
  if (error)
    return {
      ok: false,
      error: "Could not save settings. (Has migration 0016 been run?)",
    };
  return { ok: true };
}

// ── Proposal profile (the standard, reusable proposal sections) ──────────────

/** Save the company's standard proposal sections (Who We Are, etc.). */
export async function saveProposalProfile(
  profile: ProposalProfile,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const clean: ProposalProfile = {
    ...profile,
    why_fit: (profile.why_fit ?? []).filter(
      (b) => b.title.trim() || b.body.trim(),
    ),
  };
  const { error } = await supabase.from("company_settings").upsert(
    {
      owner_id: user.id,
      proposal_profile: clean,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id" },
  );
  if (error)
    return {
      ok: false,
      error: "Could not save. (Has migration 0022 been run?)",
    };
  return { ok: true };
}

/**
 * Compose the standard proposal sections from a few plain notes about the
 * company. The owner reviews/edits the result; nothing is final until saved.
 */
export async function draftProposalProfile(notes: {
  background: string;
  strengths: string;
  precon: string;
}): Promise<{ ok: boolean; profile?: ProposalProfile; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const prompt = `You write the standard, reusable sections of a construction company's bid proposals. Use the owner's notes below. Plain, confident, professional language — no clichés, no markdown, no flowery filler. Write in first-person plural ("we").

OWNER'S NOTES
Who they are / background: ${notes.background || "(none given)"}
Strengths / what sets them apart: ${notes.strengths || "(none given)"}
Preconstruction / next-steps they offer: ${notes.precon || "(none given)"}

Return JSON with exactly these fields:
- who_we_are: one paragraph (3-6 sentences) introducing the company.
- why_fit: an array of exactly 4 objects { title, body }. Each title is 2-3 words (e.g. "Proactive Coordination"); each body is one sentence. These are the reasons an owner should pick them.
- next_steps: one short paragraph on meeting to walk through the bid and moving into preconstruction services.
- license_note: one sentence noting any license/bonding that lets them perform excluded site/public-works scope under separate contract (write a sensible generic version if the notes don't say).
- finish_note: one sentence offering a standard "Basic Package" of code-compliant finish materials, submittals on request.
- closing: one warm sentence thanking them and looking forward to building together.`;

  try {
    const client = getAnthropicClient();
    const stream = client.beta.messages.stream({
      model: AI_MODELS.letter,
      max_tokens: 1500,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              who_we_are: { type: "string" },
              why_fit: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    body: { type: "string" },
                  },
                  required: ["title", "body"],
                },
              },
              next_steps: { type: "string" },
              license_note: { type: "string" },
              finish_note: { type: "string" },
              closing: { type: "string" },
            },
            required: [
              "who_we_are",
              "why_fit",
              "next_steps",
              "license_note",
              "finish_note",
              "closing",
            ],
          },
        },
      },
      messages: [{ role: "user", content: prompt }],
    });
    const msg = await stream.finalMessage();
    const textBlock = msg.content.find((b) => b.type === "text");
    const text =
      textBlock && "text" in textBlock ? (textBlock.text as string) : "";
    const parsed = JSON.parse(text) as ProposalProfile;
    // Guard: keep exactly the shape we expect, fall back per field.
    return {
      ok: true,
      profile: {
        who_we_are: parsed.who_we_are?.trim() || DEFAULT_PROFILE.who_we_are,
        why_fit:
          Array.isArray(parsed.why_fit) && parsed.why_fit.length
            ? parsed.why_fit.slice(0, 4)
            : DEFAULT_PROFILE.why_fit,
        next_steps: parsed.next_steps?.trim() || DEFAULT_PROFILE.next_steps,
        license_note:
          parsed.license_note?.trim() || DEFAULT_PROFILE.license_note,
        finish_note: parsed.finish_note?.trim() || DEFAULT_PROFILE.finish_note,
        closing: parsed.closing?.trim() || DEFAULT_PROFILE.closing,
      },
    };
  } catch {
    return { ok: false, error: "Could not draft — try again." };
  }
}
