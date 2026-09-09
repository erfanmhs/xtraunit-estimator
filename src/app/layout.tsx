import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { DM_Sans, Outfit } from "next/font/google";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

// DM Sans — body and interface text.
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

// Outfit — modern, clean sans used for headings/display.
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "XtraUnit Estimator",
  description:
    "Construction plan estimating tool — turn plans into priced scopes and proposals.",
  icons: { icon: "/favicon.png" },
};

// Mobile viewport: real device width, 1:1 scale, and `viewport-fit=cover` so
// the layout can extend behind notches/home bars (we pad with safe-area
// insets). Deliberately NO maximum-scale / user-scalable=no — locking zoom is
// an accessibility failure and iOS ignores it anyway.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Matches --background in the dark theme (the default). ThemeToggle rewrites
  // this meta tag when the user switches, so the phone's status bar follows.
  themeColor: "#0b0e14",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The theme script is inline, and the CSP is nonce-based with
  // 'strict-dynamic' — without this nonce the browser refuses to run it and
  // every light-mode user gets a dark flash. `src/proxy.ts` sets the header.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      // The init script sets data-theme before paint; React must not complain
      // that the server markup didn't have it.
      suppressHydrationWarning
      className={`${dmSans.variable} ${outfit.variable} h-full antialiased`}
    >
      <head>
        {/* Applies the saved theme BEFORE the first paint, so a light-mode
            user never sees a dark flash on load. Must be inline and blocking;
            anything async is already too late. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
          attributes into <body> before React loads, causing a false-alarm
          hydration warning. Only attribute mismatches on this element are
          suppressed — real errors elsewhere still surface. */}
      <body
        suppressHydrationWarning
        className="h-full flex flex-col bg-background text-foreground font-sans"
      >
        {children}
      </body>
    </html>
  );
}
