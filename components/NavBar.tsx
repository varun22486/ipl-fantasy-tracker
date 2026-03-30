"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";

const NAV_ITEMS = [
  { href: "/", label: "📊 Series" },
  { href: "/match", label: "🏏 Live Match" },
  { href: "/select", label: "👥 Select Teams" },
];

export default function NavBar({ title, subtitle }: { title?: string; subtitle?: string }) {
  const path = usePathname();

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13, color: "#64748b" }}>IPL Fantasy Tracker</div>
          {title && <h1 style={{ margin: "4px 0 0", fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{title}</h1>}
          {subtitle && <div style={{ fontSize: 14, color: "#64748b", marginTop: 2 }}>{subtitle}</div>}
        </div>
      </div>
      <nav style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {NAV_ITEMS.map(({ href, label }) => {
          const active = path === href;
          return (
            <Link
              key={href}
              href={href}
              style={{
                padding: "8px 16px",
                borderRadius: 10,
                border: active ? "1px solid #0f172a" : "1px solid #e2e8f0",
                background: active ? "#0f172a" : "white",
                color: active ? "white" : "#475569",
                textDecoration: "none",
                fontWeight: active ? 700 : 500,
                fontSize: 14,
                transition: "all 0.15s ease",
              }}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
