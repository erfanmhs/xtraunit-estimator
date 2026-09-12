"use client";

/**
 * "Take photo" — opens the phone's camera straight away (`capture` asks for
 * the rear camera; iOS and Android honour it, a laptop just shows a file
 * picker). One shot per press. The caller gets the raw File and decides
 * what to make of it (see src/lib/photo.ts).
 */
import { useRef, type ReactNode } from "react";

export default function CameraButton({
  onPhoto,
  children = "Take photo",
  className = "",
  disabled = false,
}: {
  onPhoto: (file: File) => void;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // the same photo can be taken twice
          if (f) onPhoto(f);
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.click()}
        className={`inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-brand hover:text-brand-soft disabled:opacity-50 ${className}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden>
          <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
        {children}
      </button>
    </>
  );
}
