"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import CompetitionSwitcher from "@/components/CompetitionSwitcher";

const NAV = [
  { href: "/", label: "Home", shortLabel: "Home", icon: "◇" },
  { href: "/match", label: "Match", shortLabel: "Match", icon: "◈" },
  { href: "/history", label: "History", shortLabel: "History", icon: "◫" },
  { href: "/competitions", label: "Leagues", shortLabel: "Leagues", icon: "◎" },
  { href: "/settings", label: "Settings", shortLabel: "Settings", icon: "○" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/competitions") return pathname === "/competitions";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ variant }: { variant: "sidebar" | "header" | "mobile" }) {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const comp = searchParams?.get("c");

  function navHref(base: string) {
    return comp ? `${base}?c=${comp}` : base;
  }

  if (variant === "sidebar") {
    return (
      <nav className="app-sidebar__nav">
        {NAV.map(({ href, label, icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link key={href} href={navHref(href)} className={`app-sidebar__link${active ? " app-sidebar__link--active" : ""}`}>
              <span className="app-sidebar__link-icon" aria-hidden>{icon}</span>
              <span className="app-sidebar__link-text"><span className="app-sidebar__link-label">{label}</span></span>
            </Link>
          );
        })}
      </nav>
    );
  }

  if (variant === "header") {
    return (
      <nav className="mobile-header__nav">
        {NAV.map(({ href, label, icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link key={href} href={navHref(href)} className={`mobile-header__link${active ? " mobile-header__link--active" : ""}`}>
              <span className="mobile-header__icon" aria-hidden>{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <div className="mobile-nav__inner">
      {NAV.map(({ href, shortLabel, icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link key={href} href={navHref(href)} className={`mobile-nav__item${active ? " mobile-nav__item--active" : ""}`}>
            <span className="mobile-nav__item-icon" aria-hidden>{icon}</span>
            {shortLabel}
          </Link>
        );
      })}
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  void pathname; // used by isActive in NavLinks

  return (
    <div className="app-root">

      {/* ── Desktop sidebar (≥ 900 px) ────────────────────────────────────── */}
      <aside className="app-sidebar" aria-label="Main navigation">
        <div className="app-sidebar__brand">
          <p className="app-sidebar__logo">Fantasy</p>
          <h1 className="app-sidebar__title">IPL Tracker</h1>
          <Suspense fallback={null}>
            <CompetitionSwitcher variant="sidebar" />
          </Suspense>
        </div>
        <Suspense fallback={null}><NavLinks variant="sidebar" /></Suspense>
        <div className="app-sidebar__footer">Private league · data in your Supabase</div>
      </aside>

      {/* ── Tablet top bar (640 – 899 px) ─────────────────────────────────── */}
      <header className="mobile-header" aria-label="Main navigation">
        <div className="mobile-header__row">
          <span className="mobile-header__brand">🏏 IPL Tracker</span>
          <Suspense fallback={null}>
            <NavLinks variant="header" />
          </Suspense>
        </div>
        <Suspense fallback={null}>
          <CompetitionSwitcher variant="inline" />
        </Suspense>
      </header>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="app-content">{children}</div>

      {/* ── Mobile: competition pills above bottom tabs (< 640 px) ─────── */}
      <div className="mobile-comp-bar" aria-label="Competitions">
        <Suspense fallback={null}>
          <CompetitionSwitcher variant="inline" />
        </Suspense>
      </div>

      {/* ── Mobile bottom tab bar (< 640 px) ──────────────────────────────── */}
      <nav className="mobile-nav" aria-label="Main navigation">
        <Suspense fallback={null}><NavLinks variant="mobile" /></Suspense>
      </nav>

    </div>
  );
}
