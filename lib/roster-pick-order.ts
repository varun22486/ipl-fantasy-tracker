/** Stable key so roster labels match stored lineup names (trim, case, Unicode NFC). */
export function rosterNameKey(n: string): string {
  const t = n.trim().toLowerCase();
  try {
    return t.normalize("NFC");
  } catch {
    return t;
  }
}

/** Sort A–Z by first name (first word), then full name — tiebreaker and fallback when no pick history. */
export function sortRosterByFirstName(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const ta = a.trim();
    const tb = b.trim();
    const fa = (ta.split(/\s+/)[0] ?? "").toLowerCase();
    const fb = (tb.split(/\s+/)[0] ?? "").toLowerCase();
    const c = fa.localeCompare(fb, undefined, { sensitivity: "base" });
    if (c !== 0) return c;
    return ta.localeCompare(tb, undefined, { sensitivity: "base" });
  });
}

/**
 * Order roster chips by how often each name was saved in fantasy lineups for this competition
 * (highest first), then A–Z by first name.
 */
export function sortRosterByPickCountThenName(
  names: string[],
  pickCounts?: Record<string, number> | null
): string[] {
  if (!pickCounts || Object.keys(pickCounts).length === 0) return sortRosterByFirstName(names);
  return [...names].sort((a, b) => {
    const ca = pickCounts[rosterNameKey(a)] ?? 0;
    const cb = pickCounts[rosterNameKey(b)] ?? 0;
    if (cb !== ca) return cb - ca;
    const ta = a.trim();
    const tb = b.trim();
    const fa = (ta.split(/\s+/)[0] ?? "").toLowerCase();
    const fb = (tb.split(/\s+/)[0] ?? "").toLowerCase();
    const c = fa.localeCompare(fb, undefined, { sensitivity: "base" });
    if (c !== 0) return c;
    return ta.localeCompare(tb, undefined, { sensitivity: "base" });
  });
}
