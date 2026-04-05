"use client";

import { writeActiveMatchIdCookie } from "@/lib/active-match-cookie-client";

/** After POST /api/seed — focus the new match and land on the live match page. */
export function navigateToMatchAfterSeed(matchId: number) {
  writeActiveMatchIdCookie(matchId);
  const c = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("c");
  const url =
    c != null && c !== ""
      ? `/match?c=${encodeURIComponent(c)}&m=${matchId}`
      : `/match?m=${matchId}`;
  window.location.href = url;
}
