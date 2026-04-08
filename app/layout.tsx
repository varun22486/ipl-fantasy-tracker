import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Syne } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";

const fontSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans-var",
  display: "swap",
});

/** Display / headlines — pairs with Jakarta for body (premier broadcast feel). */
const fontDisplay = Syne({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display-var",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: {
    default: "IPL Fantasy Tracker",
    template: "%s · IPL Fantasy Tracker",
  },
  description:
    "Head-to-head IPL fantasy for your private league — live CricAPI scores, lineups, MoM, and season analytics.",
  keywords: ["IPL", "fantasy cricket", "Indian Premier League", "private league", "live scores"],
  authors: [{ name: "IPL Fantasy Tracker" }],
  openGraph: {
    type: "website",
    locale: "en_IN",
    siteName: "IPL Fantasy Tracker",
    title: "IPL Fantasy Tracker",
    description: "Premier-style dashboard for your IPL fantasy league — live data, charts, and head-to-head stats.",
  },
  twitter: {
    card: "summary_large_image",
    title: "IPL Fantasy Tracker",
    description: "Live IPL fantasy scores, lineups, and season analytics for your league.",
  },
  robots: { index: true, follow: true },
  appleWebApp: {
    capable: true,
    title: "IPL Fantasy",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef2f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a1628" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fontSans.variable} ${fontDisplay.variable}`}>
      <body className={fontSans.className}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
