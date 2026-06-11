/**
 * Supabase client for the SERVER (server components, route handlers, server actions).
 *
 * Use this anywhere code runs on the server rather than in the browser — for
 * example, loading data before a page is sent to the user, or inside an API
 * route. It reads and writes the login cookie so a signed-in user stays signed
 * in across page loads.
 *
 * Note: this function is async because reading cookies is async in this version
 * of Next.js. Always `await createClient()` when you use it.
 *
 * Credentials are read from environment variables (see .env.local.example).
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // This can be called from a Server Component, where setting cookies
            // is not allowed. It is safe to ignore here as long as session
            // refreshing is handled in middleware (added later when we wire up auth).
          }
        },
      },
    },
  );
}
