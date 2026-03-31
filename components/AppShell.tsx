"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Home", desc: "Series overview and charts", icon: "\u25c7" },
  { href: "/match", label: "Live match", desc: "Scores and sync", icon: "\u25c8" },
  { href: "/select", label: "Select teams", desc: "Lineups and fixture", icon: "\u25ce" },
  { href: "/settings", label: "Settings", desc: "Names and scoring", icon: "\u25cb" },
];

function navActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";

  return (
    <div className="app-root">
      <aside className="app-sidebar" aria-label="Main navigation">
        <div className="app-sidebar__brand">
          <p className="app-sidebar__logo">Fantasy</p>
          <h1 className="app-sidebar__title">IPL Tracker</h1>
          <p className="app-sidebar__tag">Head-to-head points, live sync, and season insights.</p>
        </div>
        <nav className="app-sidebar__nav">
          {NAV.map(({ href, label, desc, icon }) => {
            const active = navActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={`app-sidebar__link${active ? " app-sidebar__link--active" : ""}`}
              >
                <span className="app-sidebar__link-icon" aria-hidden>
                  {icon}
                </span>
                <span className="app-sidebar__link-text">
                  <span className="app-sidebar__link-label">{label}</span>
                  <span className="app-sidebar__link-desc">{desc}</span>
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="app-sidebar__footer">Private league data in your Supabase</div>
      </aside>
      <div className="app-content">{children}</div>
    </div>
  );
}
