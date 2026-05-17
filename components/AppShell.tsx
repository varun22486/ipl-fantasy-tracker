"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useLayoutEffect, useState } from "react";
import { readActiveCompetitionIdFromCookie } from "@/lib/competition-id";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bug,
  History,
  Home,
  Settings,
  Trophy,
  UsersRound,
} from "lucide-react";
import CompetitionSwitcher from "@/components/CompetitionSwitcher";
import { readActiveMatchIdFromBrowserCookie } from "@/lib/active-match-cookie-client";

type NavItem = {
  href: string;
  label: string;
  shortLabel: string;
  Icon: LucideIcon;
};

const NAV: NavItem[] = [
  { href: "/", label: "Home", shortLabel: "Home", Icon: Home },
  { href: "/match", label: "Current Match", shortLabel: "Match", Icon: Activity },
  { href: "/history", label: "History", shortLabel: "History", Icon: History },
  { href: "/competitions", label: "Leagues", shortLabel: "Leagues", Icon: UsersRound },
  { href: "/debug", label: "Debug", shortLabel: "Debug", Icon: Bug },
  { href: "/settings", label: "Settings", shortLabel: "Settings", Icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/competitions") return pathname === "/competitions";
  if (href === "/debug") return pathname === "/debug";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ variant }: { variant: "sidebar" | "header" | "mobile" }) {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const cParam = searchParams?.get("c") ?? "";
  const mParam = searchParams?.get("m") ?? "";
  const [navC, setNavC] = useState<string | null>(() => (cParam !== "" ? cParam : null));
  const [navM, setNavM] = useState<string | null>(() => (mParam !== "" ? mParam : null));

  useLayoutEffect(() => {
    if (cParam !== "") {
      setNavC(cParam);
    } else {
      const id = readActiveCompetitionIdFromCookie();
      setNavC(id != null ? String(id) : null);
    }
    if (mParam !== "") {
      setNavM(mParam);
    } else {
      const mid = readActiveMatchIdFromBrowserCookie();
      setNavM(mid && /^\d+$/.test(mid.trim()) ? mid.trim() : null);
    }
  }, [pathname, cParam, mParam]);

  function navHref(base: string) {
    const params = new URLSearchParams();
    if (navC) params.set("c", navC);
    // Carry ?m= for match/select when the cookie points at a saved fixture (set on lineup save).
    if ((base === "/select" || base === "/match") && navM) params.set("m", navM);
    const q = params.toString();
    return q ? `${base}?${q}` : base;
  }

  if (variant === "sidebar") {
    return (
      <nav className="app-sidebar__nav">
        {NAV.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={navHref(href)}
              className={`app-sidebar__link${active ? " app-sidebar__link--active" : ""}`}
            >
              <Icon className="nav-icon nav-icon--sidebar" aria-hidden size={20} strokeWidth={1.75} />
              <span className="app-sidebar__link-text">
                <span className="app-sidebar__link-label">{label}</span>
              </span>
            </Link>
          );
        })}
      </nav>
    );
  }

  if (variant === "header") {
    return (
      <nav className="mobile-header__nav">
        {NAV.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={navHref(href)}
              className={`mobile-header__link${active ? " mobile-header__link--active" : ""}`}
            >
              <Icon className="nav-icon nav-icon--header" aria-hidden size={16} strokeWidth={1.75} />
              {label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <div className="mobile-nav__inner">
      {NAV.map(({ href, shortLabel, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={navHref(href)}
            className={`mobile-nav__item${active ? " mobile-nav__item--active" : ""}`}
          >
            <Icon className="nav-icon nav-icon--mobile" aria-hidden size={24} strokeWidth={1.65} />
            {shortLabel}
          </Link>
        );
      })}
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  void pathname;

  return (
    <div className="app-root">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <aside className="app-sidebar" aria-label="Main navigation">
        <div className="app-sidebar__brand">
          <div className="app-sidebar__brand-row">
            <div className="app-sidebar__mark" aria-hidden>
              <Trophy size={22} strokeWidth={2.15} />
            </div>
            <div className="app-sidebar__brand-text">
              <p className="app-sidebar__logo">Fantasy</p>
              <h1 className="app-sidebar__title">IPL Tracker</h1>
            </div>
          </div>
          <Suspense fallback={null}>
            <CompetitionSwitcher variant="sidebar" />
          </Suspense>
        </div>
        <Suspense fallback={null}>
          <NavLinks variant="sidebar" />
        </Suspense>
        <div className="app-sidebar__footer">
          <span className="app-sidebar__footer-inner">Private league · encrypted on your Supabase</span>
        </div>
      </aside>

      <header className="mobile-header" aria-label="Main navigation">
        <div className="mobile-header__row">
          <span className="mobile-header__brand">
            <span className="mobile-header__mark" aria-hidden>
              <Trophy size={17} strokeWidth={2.1} />
            </span>
            <span className="mobile-header__brand-text">IPL Tracker</span>
          </span>
          <Suspense fallback={null}>
            <NavLinks variant="header" />
          </Suspense>
        </div>
        <Suspense fallback={null}>
          <CompetitionSwitcher variant="inline" />
        </Suspense>
      </header>

      <div id="main-content" className="app-content" tabIndex={-1}>
        {children}
      </div>

      <div className="mobile-comp-bar" aria-label="Competitions">
        <Suspense fallback={null}>
          <CompetitionSwitcher variant="inline" />
        </Suspense>
      </div>

      <nav className="mobile-nav" aria-label="Main navigation">
        <Suspense fallback={null}>
          <NavLinks variant="mobile" />
        </Suspense>
      </nav>
    </div>
  );
}
