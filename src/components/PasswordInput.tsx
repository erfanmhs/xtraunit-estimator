"use client";

/**
 * A password field with a show / hide eye. Typing a password blind on a
 * phone keyboard is how people lock themselves out; a tap on the eye shows
 * what was typed. Used by sign-in, create-account and reset-password so all
 * three behave the same.
 *
 * Takes every prop an <input> takes; `className` styles the input itself
 * (the wrapper only adds the room for the eye).
 */
import { useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export default function PasswordInput({ className = "", ...props }: Props) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={shown ? "text" : "password"} className={`${className} w-full pr-11`} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        title={shown ? "Hide password" : "Show password"}
        // 44 px hit target for a thumb; sits inside the field's right edge.
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted transition-colors hover:text-foreground"
      >
        {shown ? (
          // Eye with a slash — password is visible, tap to hide.
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden>
            <path d="M3 3l18 18" strokeLinecap="round" />
            <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
            <path d="M9.9 5.1A10.4 10.4 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.6 6.6C4.4 8 2.7 10 2 12c1 2.5 5 7 10 7 1.5 0 2.9-.4 4.2-1" strokeLinecap="round" />
          </svg>
        ) : (
          // Open eye — password is hidden, tap to show.
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden>
            <path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
