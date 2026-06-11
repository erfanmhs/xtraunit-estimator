import Image from "next/image";
import AuthForm from "./AuthForm";
import { siteConfig } from "@/config/site";

/**
 * Login screen shell (XtraUnit dark theme). The interactive form — sign in,
 * create account, forgot password — lives in <AuthForm />.
 */
export default function LoginPage() {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6">
      {/* Garnet gradient wash — makes the brand red clearly visible over the dark base */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(75%_60%_at_50%_32%,rgba(160,28,45,0.45),rgba(160,28,45,0.12)_45%,transparent_78%)]"
      />
      {/* Soft garnet glow on top for depth — centered on the form so the halo
          around it is even all the way around */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[62vh] w-[62vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/30 blur-[140px]"
      />

      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center gap-8 rounded-2xl border border-border bg-surface/70 p-8 backdrop-blur-sm">
          <Image
            src="/logo-wordmark-white.png"
            alt={siteConfig.company}
            width={300}
            height={71}
            priority
            className="h-auto w-48"
          />
          <AuthForm />
        </div>

        <p className="mt-6 text-center text-[11px] uppercase tracking-[0.2em] text-muted/60">
          {siteConfig.licenseText}
        </p>
      </div>
    </main>
  );
}
