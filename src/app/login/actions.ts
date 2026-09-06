"use server";

/**
 * Server-side auth actions.
 *
 * Sign-in and password reset still happen in the browser (AuthForm.tsx talks
 * to Supabase directly — Supabase applies its own per-IP limits there).
 * SIGN-UP goes through here on purpose: it's the one action a stranger can
 * take that creates a user who could then spend the AI budget, so it gets
 *   1. an on/off switch (NEXT_PUBLIC_ALLOW_SIGNUP=false closes it fully),
 *   2. rate limits — per address and a global ceiling (rate-limit.ts),
 *   3. input validation.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, clientIp, LIMITS } from "@/lib/rate-limit";
import { log } from "@/lib/log";

// A "use server" file may only EXPORT async functions, so this stays local.
// AuthForm.tsx reads the same env var to hide the "Create an account" link.
const SIGNUP_OPEN = process.env.NEXT_PUBLIC_ALLOW_SIGNUP !== "false";

const signUpInput = z.object({
  email: z.string().trim().toLowerCase().email("That email doesn't look right.").max(254),
  password: z
    .string()
    .min(6, "Password needs at least 6 characters.")
    .max(200, "That password is too long."),
  // Where the confirmation email should send them back to (the app's origin).
  origin: z.string().url().max(200),
});

export async function signUp(input: {
  email: string;
  password: string;
  origin: string;
}): Promise<{ ok: boolean; signedIn?: boolean; error?: string }> {
  if (!SIGNUP_OPEN)
    return {
      ok: false,
      error: "New accounts are by invitation. Ask Erfan to add you.",
    };

  const parsed = signUpInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { email, password, origin } = parsed.data;

  // Burst guards: per address, then the global ceiling.
  const ip = await clientIp();
  const perIp = rateLimit(`signup:ip:${ip}`, LIMITS.signupPerIp, "sign-up attempts");
  if (!perIp.ok) return { ok: false, error: perIp.error };
  const global = rateLimit("signup:global", LIMITS.signupGlobal, "sign-ups");
  if (!global.ok) return { ok: false, error: global.error };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/login` },
  });
  if (error) {
    log.warn("auth.signup.failed", { ip, err: error });
    return { ok: false, error: error.message };
  }
  log.info("auth.signup.ok", { ip, confirmed: !!data.session });
  // A session means email confirmation is off and they're signed in now (the
  // server client already wrote the cookie).
  return { ok: true, signedIn: !!data.session };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
