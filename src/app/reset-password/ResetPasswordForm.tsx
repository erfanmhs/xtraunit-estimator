"use client";

/**
 * Set-a-new-password form.
 *
 * The user arrives here by clicking the reset link in their email. The Supabase
 * browser client automatically turns that link into a temporary session, which
 * lets us call updateUser() to set the new password. On success we drop them
 * straight into the app.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordForm() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(
        /session|missing|expired/i.test(error.message)
          ? "Your reset link has expired. Request a new one from the sign-in page."
          : error.message,
      );
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="font-heading text-2xl text-foreground">New Password</h1>
        <p className="text-xs uppercase tracking-[0.25em] text-muted">
          Choose a new password
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-center text-sm text-brand-soft"
        >
          {error}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="password"
            className="text-xs font-medium uppercase tracking-wider text-muted"
          >
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="rounded-md border border-border bg-background px-3 py-2.5 text-foreground placeholder:text-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          <p className="text-xs text-muted/70">At least 6 characters.</p>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 rounded-md bg-brand py-2.5 font-medium text-white transition-colors hover:bg-brand-strong focus:outline-none focus:ring-2 focus:ring-brand/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Saving…" : "Save new password"}
        </button>
      </form>
    </div>
  );
}
