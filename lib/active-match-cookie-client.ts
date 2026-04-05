"use client";

import { ACTIVE_MATCH_COOKIE } from "@/lib/active-match-constants";

const MAX_AGE_SEC = 60 * 60 * 24 * 7;

export function writeActiveMatchIdCookie(matchId: number) {
  document.cookie = `${ACTIVE_MATCH_COOKIE}=${matchId}; path=/; max-age=${MAX_AGE_SEC}; SameSite=Lax`;
}

export function readActiveMatchIdFromBrowserCookie(): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const t = part.trim();
    if (t.startsWith(`${ACTIVE_MATCH_COOKIE}=`))
      return decodeURIComponent(t.slice(ACTIVE_MATCH_COOKIE.length + 1).trim());
  }
  return null;
}
