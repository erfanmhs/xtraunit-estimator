/**
 * Email-link confirmation handler.
 *
 * Supabase sends one-time links (for email verification or password resets) to
 * this URL. It verifies the token, which logs the user in, then forwards them
 * on. Not used by normal password sign-in, but needed for those email flows.
 */
import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  // Token missing or invalid → back to login with a message.
  return NextResponse.redirect(
    new URL("/login?error=Link+expired+or+invalid.", request.url),
  );
}
