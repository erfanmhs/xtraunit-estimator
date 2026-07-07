"use client";

/**
 * Last-resort error boundary. Next.js renders this only when the ROOT layout
 * itself throws — so it replaces <html>/<body> and can't rely on the normal
 * stylesheet loading. Brand colors are therefore inlined here on purpose.
 *
 * When error tracking (Sentry) is added, report from the effect below.
 */
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // TODO(error-tracking): Sentry.captureException(error)
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0b",
          color: "#f4f4f5",
          fontFamily: "system-ui, Arial, Helvetica, sans-serif",
          padding: "2rem",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "28rem",
            textAlign: "center",
            background: "#141416",
            border: "1px solid #2a2a2e",
            borderRadius: "0.75rem",
            padding: "2rem",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>
            The app hit a problem
          </h1>
          <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#a1a1aa" }}>
            Something failed while loading. Reloading usually fixes it. If it
            keeps happening, send Erfan this code.
          </p>
          {error.digest ? (
            <p
              style={{
                marginTop: "0.75rem",
                fontFamily: "monospace",
                fontSize: "0.75rem",
                color: "#a1a1aa",
                border: "1px solid #2a2a2e",
                borderRadius: "0.375rem",
                padding: "0.375rem 0.75rem",
              }}
            >
              {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: "1.5rem",
              cursor: "pointer",
              background: "#a01c2d",
              color: "#ffffff",
              border: "none",
              borderRadius: "0.375rem",
              padding: "0.625rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
