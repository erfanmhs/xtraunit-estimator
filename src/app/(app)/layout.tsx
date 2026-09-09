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
    // Column on phones (content above the bottom tab bar), row from `sm` up
    // (rail on the left). The bar is rendered by AppSidebar with `order-last`.
    <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden sm:flex-row">
      {/* One consistent backdrop for the whole app. The glass panels pick it
          up through their blur — without something behind them they stop
          looking like glass. Neutral slate with one small pool of brand
          colour; see `.app-ambient` in globals.css. */}
      <div aria-hidden className="app-ambient pointer-events-none absolute inset-0" />
      <AppSidebar email={user?.email ?? null} />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
