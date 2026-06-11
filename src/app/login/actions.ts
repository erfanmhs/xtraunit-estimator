"use server";

/**
 * Server-side sign-out. (Sign-in, sign-up, and password reset happen in the
 * browser via AuthForm.tsx; only sign-out runs here, triggered by the button
 * on the homepage.)
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
