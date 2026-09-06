import type { Metadata, Viewport } from "next";
import { DM_Sans, Outfit } from "next/font/google";
import "./globals.css";

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
  themeColor: "#0a0a0b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${outfit.variable} h-full antialiased`}
    >
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
