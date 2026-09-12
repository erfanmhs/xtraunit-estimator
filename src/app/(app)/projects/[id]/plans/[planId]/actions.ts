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
import { recordAiUsage } from "@/lib/ai-meter";
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
