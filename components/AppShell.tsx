"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  History,
  Home,
  Settings,
  Trophy,
  UsersRound,
} from "lucide-react";
import CompetitionSwitcher from "@/components/CompetitionSwitcher";

type NavItem = {
  href: string;
  label: string;
  shortLabel: string;
  Icon: LucideIcon;
};

const NAV: NavItem[] = [
  { href: "/", label: "Home", shortLabel: "Home", Icon: Home },
  { href: "/match", label: "Match", shortLabel: "Match", Icon: Activity },
  { href: "/history", label: "History", shortLabel: "History", Icon: History },
  { href: "/competitions", label: "Leagues", shortLabel: "Leagues", Icon: UsersRound },
  { href: "/settings", label: "Settings", shortLabel: "Settings", Icon: Settings },
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
            <Icon className="nav-icon nav-icon--mobile" aria-hidden size={22} strokeWidth={1.65} />
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
          <span className="app-sidebar__footer-inner">Private league · your Supabase data</span>
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

      <div className="app-content">{children}</div>

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
