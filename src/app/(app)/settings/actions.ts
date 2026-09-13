"use server";

/**
 * Company settings: identity (proposal letterhead) + default markups
 * (pre-fill every new project's Estimate). One row per user, upserted.
 */
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient } from "@/lib/anthropic";
import { enforceAiLimit, settleAiUsage } from "@/lib/ai-usage";
import { log } from "@/lib/log";
import { recordAiUsage } from "@/lib/ai-meter";
import { AI_MODELS } from "@/config/ai";
import {
  DEFAULT_PROFILE,
  type ProposalProfile,
} from "@/lib/proposal/profile";
import { DEFAULT_COMPLIANCE } from "@/lib/proposal/contract";
import { isHexColor, isLogoDataUrl, resolveBranding, VOICE_GUIDE, JOB_TYPE_LABELS, type Branding } from "@/lib/branding";
import { companySettingsInput, firstIssue } from "@/lib/validation";

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

  const parsed = companySettingsInput.safeParse(settings);
  if (!parsed.success)
    return {
      ok: false,
      error: firstIssue(parsed.error, "Markups must be between 0 and 100 percent."),
    };

  const { error } = await supabase.from("company_settings").upsert(
    { owner_id: user.id, ...parsed.data, updated_at: new Date().toISOString() },
    { onConflict: "owner_id" },
  );
  if (error)
    return {
      ok: false,
      error: "Could not save settings. (Has migration 0016 been run?)",
    };
  return { ok: true };
}

// ── Branding (logo, colour, theme, slogan, voice, job types) ─────────────────

const brandingInput = z.object({
  logo: z.string().refine(isLogoDataUrl, "The logo must be a small PNG, JPEG or WebP.").nullable(),
  primary: z.string().refine(isHexColor, "The colour must be a #rrggbb value."),
  theme: z.enum(["dark", "light", "system"]),
  slogan: z.string().trim().max(120),
  tagline: z.string().trim().max(200),
  voice: z.enum(["plain", "warm", "formal"]),
  job_types: z.array(z.string().max(40)).max(12),
  onboarded_at: z.string().nullable(),
});

/** Save the company's look. One JSON block on company_settings (migration 0044). */
export async function saveBranding(branding: Branding): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const parsed = brandingInput.safeParse(branding);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error, "Check the branding fields.") };
  const clean = resolveBranding({ ...parsed.data, primary: parsed.data.primary.toLowerCase() });
  const { error } = await supabase
    .from("company_settings")
    .upsert({ owner_id: user.id, branding: clean, updated_at: new Date().toISOString() }, { onConflict: "owner_id" });
  if (error) {
    log.warn("branding.save_failed", { userId: user.id, err: error });
    return { ok: false, error: "Could not save the branding. (Has migration 0044 been run?)" };
  }
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
  /** The company's voice and work, from branding — shapes the register and the examples. */
  company_name?: string;
  voice?: "plain" | "warm" | "formal";
  job_types?: string[];
  slogan?: string;
}): Promise<{ ok: boolean; profile?: ProposalProfile; slogans?: string[]; tagline?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const limit = await enforceAiLimit(supabase, user.id, "profile");
  if (!limit.ok) return { ok: false, error: limit.error };

  const voice = notes.voice ?? "plain";
  const jobs = (notes.job_types ?? []).map((k) => JOB_TYPE_LABELS[k] ?? k).filter(Boolean);
  const prompt = `You write the standard, reusable sections of a construction company's bid proposals. Use the owner's notes below. Confident, professional language — no clichés, no markdown, no flowery filler. Write in first-person plural ("we").

VOICE: ${voice} — ${VOICE_GUIDE[voice]}. Keep every section in this voice.
${notes.company_name ? `COMPANY NAME: ${notes.company_name}
` : ""}${jobs.length ? `THE WORK THEY TAKE: ${jobs.join("; ")} — the examples and the "why us" reasons should fit these kinds of jobs and the clients who buy them.
` : ""}${notes.slogan ? `SLOGAN THEY ALREADY USE: "${notes.slogan}" — the copy may echo it, never repeat it word for word.
` : ""}
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
- closing: one warm sentence thanking them and looking forward to building together.
- slogans: an array of exactly 3 slogan options for this company — each 2 to 7 words, specific to the work they take, no puns, no exclamation marks.
- tagline: one sentence (under 20 words) that says what the company does and for whom.`;

  try {
    const client = getAnthropicClient();
    const stream = client.beta.messages.stream({
      model: AI_MODELS.letter,
      max_tokens: 1800,
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
              slogans: { type: "array", items: { type: "string" } },
              tagline: { type: "string" },
            },
            required: [
              "who_we_are",
              "why_fit",
              "next_steps",
              "license_note",
              "finish_note",
              "closing",
              "slogans",
              "tagline",
            ],
          },
        },
      },
      messages: [{ role: "user", content: prompt }],
    });
    const msg = await stream.finalMessage();
    await settleAiUsage(supabase, limit.usageId, recordAiUsage(AI_MODELS.letter, msg.usage, "profile"));
    const textBlock = msg.content.find((b) => b.type === "text");
    const text =
      textBlock && "text" in textBlock ? (textBlock.text as string) : "";
    const parsed = JSON.parse(text) as ProposalProfile & { slogans?: unknown; tagline?: unknown };
    // Guard: keep exactly the shape we expect, fall back per field.
    return {
      ok: true,
      slogans: Array.isArray(parsed.slogans) ? parsed.slogans.map((x) => String(x).trim()).filter(Boolean).slice(0, 3) : [],
      tagline: typeof parsed.tagline === "string" ? parsed.tagline.trim().slice(0, 200) : "",
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
        // Not AI-drafted — the editor keeps whatever the owner already has.
        terms: DEFAULT_PROFILE.terms,
        standard_exclusions: DEFAULT_PROFILE.standard_exclusions,
        references: [],
        compliance: DEFAULT_COMPLIANCE,
      },
    };
  } catch (e) {
    log.error("profile.draft.failed", { userId: user.id, err: e });
    return { ok: false, error: "Could not draft — try again." };
  }
}
