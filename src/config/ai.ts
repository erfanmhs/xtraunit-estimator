/**
 * One place to choose the AI model for every job in the app.
 *
 * Each role can be overridden per-deployment with an environment variable —
 * so switching models is a config change (or env edit on the host), never a
 * code hunt. Roles, not models, are referenced everywhere else.
 *
 * Tiering (Opus 4.8 ≈ $5/$25 per Mtok · Sonnet 4.6 ≈ $3/$15):
 *   HIGH-STAKES → Opus 4.8 — the jobs that determine the bid number:
 *     scopeDraft  — reads the plans + takeoff and writes the CSI scope
 *     pricing     — five-bucket direct-cost suggestions
 *   SUPPORTING  → Sonnet 4.6 — strong but cheaper; output is reviewed/editable:
 *     scopeReview — second-opinion gap-finder (also a DIFFERENT model than the
 *                   draft, so the check stays independent)
 *     quoteRead   — extracts fields from uploaded sub-quote PDFs/photos
 *     letter      — drafts the proposal cover letter (the user always edits it)
 */
export const AI_MODELS = {
  scopeDraft: process.env.AI_MODEL_SCOPE_DRAFT ?? "claude-opus-4-8",
  pricing: process.env.AI_MODEL_PRICING ?? "claude-opus-4-8",
  scopeReview: process.env.AI_MODEL_SCOPE_REVIEW ?? "claude-sonnet-4-6",
  quoteRead: process.env.AI_MODEL_QUOTE_READ ?? "claude-sonnet-4-6",
  letter: process.env.AI_MODEL_LETTER ?? "claude-sonnet-4-6",
} as const;
