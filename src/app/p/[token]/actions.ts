"use server";

/**
 * The client's "Accept" on a shared proposal. Goes through the SECURITY
 * DEFINER function accept_proposal() (migration 0033): only a valid token,
 * only once, only while the pricing is still valid.
 */
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const input = z.object({
  token: z.string().min(24).max(200),
  name: z.string().trim().min(2, "Please type your full name.").max(120),
  email: z.string().trim().max(200),
  selection: z.array(z.string().max(60)).max(30),
});

export async function acceptProposal(raw: {
  token: string;
  name: string;
  email: string;
  selection: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const parsed = input.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { token, name, email, selection } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_proposal", {
    p_token: token,
    p_name: name,
    p_email: email,
    p_selection: selection,
  });
  if (error) return { ok: false, error: "Could not record the acceptance. Please try again." };
  if (!data)
    return {
      ok: false,
      error: "This proposal can't be accepted — it may have expired or already been accepted.",
    };
  return { ok: true };
}
