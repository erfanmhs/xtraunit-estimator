"use client";

/**
 * The all-in-one auth form: Sign in / Create account / Forgot password.
 *
 * It runs in the browser and talks to Supabase directly, so switching between
 * the three modes is instant (no page reloads) and messages appear inline.
 * Keeping it in one place is what makes the experience fast and simple.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "forgot";

const BUTTONS: Record<Mode, string> = {
  signin: "Sign in",
  signup: "Create account",
  forgot: "Send reset link",
};

export default function AuthForm() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.replace("/");
        router.refresh();
        return;
      }

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/login` },
        });
        if (error) throw error;

        if (data.session) {
          // Email confirmation is off → user is signed in immediately.
          router.replace("/");
          router.refresh();
          return;
        }
        // Email confirmation is on → tell them to check their inbox.
        setNotice("Account created. Check your email to confirm, then sign in.");
        switchMode("signin");
        return;
      }

      // mode === "forgot"
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setNotice("If that email has an account, a reset link is on its way.");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "rounded-md border border-border bg-background px-3 py-2.5 text-foreground placeholder:text-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40";

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col items-center text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-muted">
          XtraUnit Estimator
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
      {notice ? (
        <p
          role="status"
          className="rounded-md border border-border bg-background/60 px-3 py-2 text-center text-sm text-foreground"
        >
          {notice}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="email"
            className="text-xs font-medium uppercase tracking-wider text-muted"
          >
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputClass}
          />
        </div>

        {mode !== "forgot" ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="password"
                className="text-xs font-medium uppercase tracking-wider text-muted"
              >
                Password
              </label>
              {mode === "signin" ? (
                <button
                  type="button"
                  onClick={() => switchMode("forgot")}
                  className="text-xs text-muted transition-colors hover:text-brand-soft"
                >
                  Forgot password?
                </button>
              ) : null}
            </div>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={inputClass}
            />
            {mode === "signup" ? (
              <p className="text-xs text-muted/70">At least 6 characters.</p>
            ) : null}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="mt-2 rounded-md bg-brand py-2.5 font-medium text-white transition-colors hover:bg-brand-strong focus:outline-none focus:ring-2 focus:ring-brand/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Please wait…" : BUTTONS[mode]}
        </button>
      </form>

      {/* Mode toggles */}
      <div className="text-center text-sm text-muted">
        {mode === "signin" ? (
          <>
            New here?{" "}
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className="font-medium text-brand-soft transition-colors hover:text-brand"
            >
              Create an account
            </button>
          </>
        ) : null}
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="font-medium text-brand-soft transition-colors hover:text-brand"
            >
              Sign in
            </button>
          </>
        ) : null}
        {mode === "forgot" ? (
          <button
            type="button"
            onClick={() => switchMode("signin")}
            className="font-medium text-brand-soft transition-colors hover:text-brand"
          >
            ← Back to sign in
          </button>
        ) : null}
      </div>
    </div>
  );
}
