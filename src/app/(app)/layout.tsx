import AppSidebar from "@/components/AppSidebar";
import { createClient } from "@/lib/supabase/server";

/**
 * Shell for all signed-in pages: sidebar on the left, page content on the right.
 * The proxy already blocks signed-out visitors; we read the user here only to
 * show their email and power the Sign out button.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="relative flex flex-1 min-h-0 overflow-hidden">
      {/* Same garnet wash + glow as the login page — one consistent backdrop
          for the whole app; the glass panels pick it up through their blur. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(75%_60%_at_50%_50%,rgba(160,28,45,0.45),rgba(160,28,45,0.12)_45%,transparent_78%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[62vh] w-[62vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/30 blur-[140px]"
      />
      <AppSidebar email={user?.email ?? null} />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
