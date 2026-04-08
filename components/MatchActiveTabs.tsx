"use client";

import Link from "next/link";
import { formatFixture } from "@/lib/format";
import { writeActiveMatchIdCookie } from "@/lib/active-match-cookie-client";

type Row = { id: number; fixture?: string | null };

/**
 * When more than one fixture is **actively live** (`is_current` + in-play status),
 * tab links use ?m= and set a cookie so lineup, roster, sync, and the active tab stay aligned.
 */
export default function MatchActiveTabs({
  matches,
  selectedId,
  basePath,
  competitionSuffix,
}: {
  matches: Row[];
  selectedId: number;
  basePath: "/match" | "/select";
  competitionSuffix: string;
}) {
  if (matches.length <= 1) return null;
  return (
    <nav className="match-active-tabs" aria-label="Live IPL matches">
      <span className="match-active-tabs__label">
        {matches.length} live {matches.length === 1 ? "match" : "matches"} — open one:
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
