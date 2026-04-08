"use client";

import Link from "next/link";
import { formatFixture } from "@/lib/format";
import { writeActiveMatchIdCookie } from "@/lib/active-match-cookie-client";

type Row = { id: number; fixture?: string | null };

/**
 * When more than one tracked row applies (`is_current` on today's IPL calendar day when dates exist),
 * tab links use ?m= and set a cookie so lineup, roster, sync, and the active tab stay aligned.
 */
export default function MatchActiveTabs({
  matches,
  selectedId,
  basePath,
  competitionSuffix,
  tabsAreTodayOnly = true,
}: {
  matches: Row[];
  selectedId: number;
  basePath: "/match" | "/select";
  competitionSuffix: string;
  /** False when rows lack a schedule date — copy says "tracked" instead of "today". */
  tabsAreTodayOnly?: boolean;
}) {
  if (matches.length <= 1) return null;
  const scope = tabsAreTodayOnly ? "today (India time)" : "tracked";
  return (
    <nav
      aria-label="Tracked live matches"
      style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}
    >
      <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginRight: 4 }}>
        {matches.length} matches {scope} — open one:
      </span>
      {matches.map((m) => {
        const label = formatFixture(m.fixture ?? "") || m.fixture || `Match ${m.id}`;
        const on = m.id === selectedId;
        return (
          <Link
            key={m.id}
            href={`${basePath}?m=${m.id}${competitionSuffix}`}
            onClick={() => writeActiveMatchIdCookie(m.id)}
            style={{
              padding: "8px 14px",
              borderRadius: 12,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              border: on ? "2px solid #2563eb" : "1px solid #e2e8f0",
              background: on ? "#eff6ff" : "white",
              color: on ? "#1d4ed8" : "#475569",
              maxWidth: 320,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
