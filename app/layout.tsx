import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";

const fontSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans-var",
  display: "swap",
});

export const metadata: Metadata = {
  title: "IPL Fantasy Tracker",
  description: "Head-to-head IPL fantasy — live scores, lineups, and season stats",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontSans.variable}>
      <body className={fontSans.className}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
