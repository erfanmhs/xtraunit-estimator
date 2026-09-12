"use server";

/**
 * Viewer server actions.
 *
 * polishSheetNotes — the "Dictate" button. The browser already turned speech
 * into a transcript; this asks the AI to rewrite it as short, factual notes
 * about THIS sheet (what the estimator's scope pass should know), in the
 * user's own facts, then the viewer appends them to the sheet's notes box.
 */
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient } from "@/lib/anthropic";
import { enforceAiLimit, settleAiUsage } from "@/lib/ai-usage";
import { recordAiUsage, runWithAiBudget } from "@/lib/ai-meter";
import { countSymbolsOnSheet, type AiCountResult } from "@/lib/takeoff/aiCount";
import { log } from "@/lib/log";
import { AI_MODELS } from "@/config/ai";

// Not exported: a "use server" file may only export async functions.
const notesInput = z.object({
  projectId: z.string().uuid(),
  sheetId: z.string().uuid(),
  transcript: z.string().trim().min(1).max(4000),
  existing: z.string().max(8000).optional(),
});

export async function polishSheetNotes(
  raw: z.infer<typeof notesInput>,
): Promise<{ ok: boolean; notes?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const parsed = notesInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Nothing usable was heard." };
  const { projectId, sheetId, transcript, existing } = parsed.data;

  const limit = await enforceAiLimit(supabase, user.id, "notes");
  if (!limit.ok) return { ok: false, error: limit.error };

  // Context for the AI — RLS scopes both reads to the signed-in user.
  const [{ data: sheet }, { data: project }] = await Promise.all([
    supabase
      .from("sheets")
      .select("name,label,page_number,discipline")
      .eq("id", sheetId)
      .maybeSingle(),
    supabase.from("projects").select("name,project_type").eq("id", projectId).maybeSingle(),
  ]);

  const sheetName =
    (sheet as { name?: string | null; label?: string | null; page_number?: number } | null)?.name ||
    (sheet as { label?: string | null } | null)?.label ||
    `Sheet ${(sheet as { page_number?: number } | null)?.page_number ?? ""}`;
  const discipline = (sheet as { discipline?: string | null } | null)?.discipline ?? null;

  const prompt = `You are cleaning up a construction estimator's DICTATED note about one drawing sheet. The note will be read by an AI that drafts the scope of work from the plans, so it must be short, factual and specific.

PROJECT: ${(project as { name?: string | null } | null)?.name ?? "—"}${(project as { project_type?: string | null } | null)?.project_type ? ` (${(project as { project_type?: string }).project_type})` : ""}
SHEET: ${sheetName}${discipline ? ` — ${discipline}` : ""}
${existing?.trim() ? `NOTES ALREADY ON THIS SHEET (do not repeat these):\n${existing.trim()}\n` : ""}
DICTATION (speech-to-text, may have mis-heard words, fillers and run-ons):
"""
${transcript}
"""

Rewrite the dictation as bullet notes, one fact per bullet, each starting with "• ". Keep every fact, number, material, dimension, location and exclusion the speaker gave; fix obvious speech-to-text slips using construction context (e.g. "two by four" → 2x4, "C M U" → CMU, "gyp board" stays). Do NOT add facts, assumptions or advice the speaker did not say. Drop fillers ("um", "so basically"). Plain text only — no headings, no markdown beyond the bullets. If the dictation contains nothing about the sheet, return exactly: (nothing usable)`;

  try {
    const client = getAnthropicClient();
    const msg = await client.messages.create({
      model: AI_MODELS.letter,
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });
    await settleAiUsage(supabase, limit.usageId, recordAiUsage(AI_MODELS.letter, msg.usage, "notes"));
    const text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    if (!text || text === "(nothing usable)")
      return { ok: false, error: "Nothing about the sheet was heard — try again." };
    log.info("notes.dictated", { projectId, sheetId, userId: user.id, chars: text.length });
    return { ok: true, notes: text };
  } catch (e) {
    log.error("notes.dictate.failed", { projectId, sheetId, userId: user.id, err: e });
    return { ok: false, error: "Couldn't turn that into notes — try again." };
  }
}

// ── AI symbol count ─────────────────────────────────────────────────────────
// The viewer renders the sheet to a JPEG (≤ 1568 px long edge, the size the
// model reads best) and sends it here. Metered like every one-shot AI call.
const countInput = z.object({
  projectId: z.string().uuid(),
  sheetId: z.string().uuid(),
  sheetName: z.string().max(200).nullable(),
  jpegBase64: z.string().min(100).max(1_300_000), // the viewer keeps it under 1.2 M; the action body limit is 2 MB
  wanted: z.array(z.string().max(40)).max(12).optional(),
});

export async function aiCountSheet(
  raw: z.infer<typeof countInput>,
): Promise<{ ok: boolean; result?: AiCountResult; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const parsed = countInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "The sheet image did not come through." };
  const { projectId, sheetId, sheetName, jpegBase64, wanted } = parsed.data;

  // The sheet must be the user's (RLS makes a stranger's sheet read as missing).
  const { data: sheet } = await supabase
    .from("sheets")
    .select("id")
    .eq("id", sheetId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!sheet) return { ok: false, error: "Sheet not found." };

  const limit = await enforceAiLimit(supabase, user.id, "aicount");
  if (!limit.ok) return { ok: false, error: limit.error };
  try {
    const { result, costUsd } = await runWithAiBudget({ label: "aicount" }, async (m) => ({
      result: await countSymbolsOnSheet({ jpegBase64, sheetName, wanted }),
      costUsd: m.spentUsd,
    }));
    await settleAiUsage(supabase, limit.usageId, costUsd);
    return { ok: true, result };
  } catch (e) {
    log.error("aicount.failed", { userId: user.id, sheetId, err: e });
    return { ok: false, error: e instanceof Error ? e.message : "The AI count failed." };
  }
}
