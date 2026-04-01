"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import CompetitionSwitcher from "@/components/CompetitionSwitcher";

const NAV = [
  { href: "/", label: "Home", shortLabel: "Home", icon: "◇" },
  { href: "/match", label: "Match", shortLabel: "Match", icon: "◈" },
  { href: "/history", label: "History", shortLabel: "History", icon: "◫" },
  { href: "/settings", label: "Settings", shortLabel: "Settings", icon: "○" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";

  return (
    <div className="app-root">

      {/* ── Desktop sidebar (≥ 900 px) ────────────────────────────────────── */}
      <aside className="app-sidebar" aria-label="Main navigation">
        <div className="app-sidebar__brand">
          <p className="app-sidebar__logo">Fantasy</p>
          <h1 className="app-sidebar__title">IPL Tracker</h1>
          <div style={{ marginTop: 12 }}>
            <CompetitionSwitcher />
          </div>
        </div>
        <nav className="app-sidebar__nav">
          {NAV.map(({ href, label, icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link key={href} href={href} className={`app-sidebar__link${active ? " app-sidebar__link--active" : ""}`}>
                <span className="app-sidebar__link-icon" aria-hidden>{icon}</span>
                <span className="app-sidebar__link-text">
                  <span className="app-sidebar__link-label">{label}</span>
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="app-sidebar__footer">Private league · data in your Supabase</div>
      </aside>

      {/* ── Tablet top bar (640 – 899 px) ─────────────────────────────────── */}
      <header className="mobile-header" aria-label="Main navigation">
        <span className="mobile-header__brand">🏏 IPL Tracker</span>
          <CompetitionSwitcher />
        <nav className="mobile-header__nav">
          {NAV.map(({ href, label, icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link key={href} href={href} className={`mobile-header__link${active ? " mobile-header__link--active" : ""}`}>
                <span className="mobile-header__icon" aria-hidden>{icon}</span>
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="app-content">{children}</div>

      {/* ── Mobile bottom tab bar (< 640 px) ──────────────────────────────── */}
      <nav className="mobile-nav" aria-label="Main navigation">
        <div className="mobile-nav__inner">
          {NAV.map(({ href, shortLabel, icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link key={href} href={href} className={`mobile-nav__item${active ? " mobile-nav__item--active" : ""}`}>
                <span className="mobile-nav__item-icon" aria-hidden>{icon}</span>
                {shortLabel}
              </Link>
            );
          })}
        </div>
      </nav>

    </div>
  );
}
