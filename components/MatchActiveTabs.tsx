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
    <nav className="match-active-tabs" aria-label="Tracked live matches">
      <span className="match-active-tabs__label">
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
            className={`match-active-tabs__chip${on ? " match-active-tabs__chip--active" : ""}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
