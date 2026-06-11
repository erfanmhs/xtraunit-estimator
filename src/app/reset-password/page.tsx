import Image from "next/image";
import ResetPasswordForm from "./ResetPasswordForm";
import { siteConfig } from "@/config/site";

/**
 * Reset-password screen shell. Reached by clicking the reset link in email.
 * The interactive part lives in <ResetPasswordForm />.
 */
export default function ResetPasswordPage() {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 h-[55vh] w-[55vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/20 blur-[130px]"
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
          <ResetPasswordForm />
        </div>
      </div>
    </main>
  );
}
