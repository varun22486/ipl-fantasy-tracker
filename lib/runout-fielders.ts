/**
 * Parse joint run-out credits from scorecard text / structured fielder strings.
 * Example (CSK vs PBKS): Prabhsimran Singh run out by Sarfaraz Khan and Ruturaj Gaikwad
 * → both keepers/fielders get one credit each when listed as `Sarfaraz Khan/Ruturaj Gaikwad`.
 */

/** Names inside `run out (A/B)` — slash or "&" / "and" join multiple fielders; each gets a credit. */
export function splitRunOutFieldersFromText(inner: string): string[] {
  const s = inner.trim();
  if (!s) return [];
  const segments = s.split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const seg of segments) {
    if (/^sub\b/i.test(seg)) continue;
    const andParts = seg.split(/\s+(?:&|and)\s+/i).map((x) => x.trim()).filter(Boolean);
    if (andParts.length > 1) {
      for (const ap of andParts) {
        const t = ap.replace(/^\(+|\)+$/g, "").trim();
        if (t.length >= 2 && !/^sub\b/i.test(t)) out.push(t);
      }
    } else {
      const t = seg.replace(/^\(+|\)+$/g, "").trim();
      if (t.length >= 2 && !/^sub\b/i.test(t)) out.push(t);
    }
  }
  return out;
}

const RUN_OUT_IN_TEXT = /run[\s_-]*out|runout/i;
const RUN_OUT_PAREN = /\brun\s+out\s*\(([^)]+)\)/i;
/** e.g. `run out Sarfaraz Khan/Ruturaj Gaikwad b Arshdeep Singh` (no parentheses). */
const RUN_OUT_SLASH_BEFORE_B = /\brun\s+out\s+(.+?)\s+b\s+/i;

/**
 * Fielder names from a dismissal / howOut string when it describes a run-out.
 * Handles `run out (A/B)` and `run out A/B b Bowler`.
 */
export function parseRunOutFieldersFromDismissalText(text: string): string[] {
  const dt = text.trim();
  if (!dt || !RUN_OUT_IN_TEXT.test(dt)) return [];

  const paren = dt.match(RUN_OUT_PAREN);
  if (paren) return splitRunOutFieldersFromText(paren[1]);

  const beforeB = dt.match(RUN_OUT_SLASH_BEFORE_B);
  if (beforeB && beforeB[1].includes("/")) {
    return splitRunOutFieldersFromText(beforeB[1].trim());
  }

  return [];
}
