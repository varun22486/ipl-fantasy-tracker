"use client";

import Link from "next/link";
import { formatFixture } from "@/lib/format";
import { writeActiveMatchIdCookie } from "@/lib/active-match-cookie-client";

type Row = { id: number; fixture?: string | null };

/**
 * When more than one `is_current` fixture needs switching (same IST day double-headers, or multiple live),
 * tab links use ?m= and set a cookie so lineup, roster, sync, and the active tab stay aligned.
 */
export default function MatchActiveTabs({
  matches,
  selectedId,
  basePath,
  competitionSuffix,
  scope = "live",
}: {
  matches: Row[];
  selectedId: number;
  basePath: "/match" | "/select";
  competitionSuffix: string;
  /** `today` = same calendar day (IST) double-header; `live` = multiple in-play tracked fixtures */
  scope?: "today" | "live";
}) {
  if (matches.length <= 1) return null;
  const label =
    scope === "today"
      ? `${matches.length} matches today (IST) — open one:`
      : `${matches.length} live ${matches.length === 1 ? "match" : "matches"} — open one:`;
  const aria =
    scope === "today" ? "Today's IPL matches" : "Live IPL matches";
  return (
    <nav className="match-active-tabs" aria-label={aria}>
      <span className="match-active-tabs__label">
        {label}
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
