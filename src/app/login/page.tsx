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
      {/* The same cool backdrop as the rest of the app, so signing in doesn't
          look like a different product. See `.app-ambient` in globals.css. */}
      <div aria-hidden className="app-ambient pointer-events-none absolute inset-0" />

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
