import AppSidebar from "@/components/AppSidebar";
import GuideFab from "@/components/guide/GuideFab";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { brandCss, DEFAULT_PRIMARY, resolveBranding } from "@/lib/branding";

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
  // The company's look: brand colour re-points the accent tokens, the logo
  // and name go on the rail, the default theme applies when this device has
  // not chosen one. Resilient to migration 0044 not run (reads as defaults).
  // select("*"): naming `branding` would make the whole read fail on a
  // database where 0044 has not run, and take the company name down with it.
  const { data: cs } = await supabase.from("company_settings").select("*").maybeSingle();
  const brand = resolveBranding(cs?.branding);
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const themeScript = `try{if(!localStorage.getItem("xu-theme")){var t=${JSON.stringify(brand.theme)};if(t==="system")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t}}catch(e){}`;

  return (
    // Column on phones (content above the bottom tab bar), row from `sm` up
    // (rail on the left). The bar is rendered by AppSidebar with `order-last`.
    <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden sm:flex-row">
      {/* One consistent backdrop for the whole app. The glass panels pick it
          up through their blur — without something behind them they stop
          looking like glass. Neutral slate with one small pool of brand
          colour; see `.app-ambient` in globals.css. */}
      <div aria-hidden className="app-ambient pointer-events-none absolute inset-0" />
      {brand.primary !== DEFAULT_PRIMARY ? <style nonce={nonce}>{brandCss(brand.primary)}</style> : null}
      {brand.theme !== "dark" ? <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} /> : null}
      <AppSidebar email={user?.email ?? null} brand={{ logo: brand.logo, name: cs?.company_name ?? null }} />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </div>
      {/* The "?" guide, every page. */}
      <GuideFab />
    </div>
  );
}
