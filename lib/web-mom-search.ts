import { formatFixture } from "@/lib/format";
import { inferMomFromSnippetsWithAi } from "@/lib/mom-ai-parse";

/**
 * MoM fallback when the cricket API omits man-of-the-match.
 * 1) DuckDuckGo HTML snippets (no key) + regex.
 * 2) If OPENAI_API_KEY is set and regex finds nothing, a small chat model infers MoM from those snippets.
 */

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function stripMatchSuffix(short: string): string {
  return short.replace(/,?\s*Match\s+\d+.*$/i, "").trim();
}

function humanizeIsoDateForSearch(iso: string): string {
  const head = iso.trim().slice(0, 10);
  const m = head.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const [, y, mo, d] = m;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = parseInt(mo, 10) - 1;
  const day = parseInt(d, 10);
  if (mi < 0 || mi > 11 || !Number.isFinite(day)) return "";
  return `${months[mi]} ${day} ${y}`;
}

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlaceholderMomName(s: string): boolean {
  return /^(tba|tbd|n\/a|na|[-–—]|pending|not\s+announced|to\s+be\s+announced)$/i.test(safeString(s).trim());
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

/** Aligns with cricket-provider `extractMomFromFreeText` plus short headline-style lines. */
function extractMomFromFreeText(text: string): string | null {
  const t = safeString(text);
  if (!t) return null;
  const patterns = [
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z.]+)+)\s+won\s+the\s+(?:player|man)\s+of\s+the\s+match\b/i,
    /\b(?:player|man)\s+of\s+the\s+match(?:\s*\([^)]*\))?\s+award\s+went\s+to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z.]+)*)/i,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z.]+)+)(?:\s*\([^)]*\))?\s+was\s+(?:named|awarded)\s+(?:the\s+)?(?:player|man)\s+of\s+the\s+match/i,
    /([A-Za-z][A-Za-z\s.'-]+?)(?:\s*\([^)]*\))?\s+was\s+(?:named|awarded)\s+(?:the\s+)?(?:player|man)\s+of\s+the\s+match/i,
    /([A-Za-z][A-Za-z\s.'-]+?)(?:\s*\([^)]*\))?\s+was\s+(?:the\s+)?(?:player|man)\s+of\s+the\s+match/i,
    /(?:player|man)\s+of\s+the\s+match\s*(?:is|goes\s+to|:)\s*([^,.|]+?)(?:\s*[,.|]|$)/i,
    /\bman\s+of\s+the\s+match\s*:?\s*([^,.|]+?)(?:\s*[,.|]|$)/i,
    /\bplayer\s+of\s+the\s+match\s*:?\s*([^,.|]+?)(?:\s*[,.|]|$)/i,
    /\bman\s+of\s+the\s+match\s+is\s+([^,.|]+?)(?:\s*[,.|]|$)/i,
    /\bm\.?\s*o\.?\s*m\.?\b\s*:?\s*([^,.|]+?)(?:\s*[,.|]|$)/i,
    /\bnamed\s+(?:the\s+)?(?:player|man)\s+of\s+the\s+match[:\s,]+([A-Za-z][A-Za-z\s.'-]+?)(?:\s*[,.]|$)/i,
    /\b(?:mom|potm)\s*[:-–—]\s*([A-Za-z][A-Za-z\s.'-]+?)(?:\s*[,.]|$)/i,
    /\b([a-z][a-z]+(?:\s+[a-z][a-z.]+)+)\s+was\s+(?:named|awarded)\s+(?:the\s+)?(?:player|man)\s+of\s+the\s+match\b/i,
    /\b([a-z][a-z]+(?:\s+[a-z][a-z.]+)+)\s+was\s+(?:the\s+)?(?:player|man)\s+of\s+the\s+match\b/i,
    /\b(?:player|man)\s+of\s+the\s+match\s*(?:is|goes\s+to|:)\s*([a-z][a-z\s.'-]+?)(?:\s*[,.|]|$)/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const name = safeString(m[1]);
      if (name && !isPlaceholderMomName(name)) return name;
    }
  }
  return null;
}

/**
 * Recap lines like "Yashasvi Jaiswal slammed 32-ball 77" (no explicit MoM phrase).
 * Only used when the merged text clearly describes a finished match and exactly one
 * batter matches this pattern — avoids guessing when two heroes are mentioned.
 */
function looksLikeFinishedMatchRecap(merged: string): boolean {
  const t = safeString(merged).toLowerCase();
  if (!t) return false;
  return (
    /\b(?:won by|won the match|won their|defeated)\b/.test(t) ||
    /\bbeat\b/.test(t) ||
    /\bmatch ended\b/.test(t) ||
    /\b(?:resounding|comprehensive|clinical)\s+win\b/.test(t)
  );
}

/**
 * Hero-batter lines in recaps (often no explicit MoM in snippets).
 * Requires finished-match cues so we do not fire on previews.
 */
function extractMomFromBattingHighlights(merged: string): string | null {
  const t = safeString(merged);
  if (!t || !looksLikeFinishedMatchRecap(t)) return null;

  const slamRe =
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z.]+)+)\s+(?:slammed|smashed|blasted|hammered|crushed|powered)\s+(?:an?\s+)?\d+-ball/gi;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = slamRe.exec(t)) !== null) {
    const n = safeString(m[1]);
    if (n && !isPlaceholderMomName(n)) found.add(n);
  }
  if (found.size === 1) return [...found][0] ?? null;

  /** e.g. "Jaiswal hit 77 off 32 balls" — only count strong innings to avoid many "12 off 8" lines */
  const offBallsRe =
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z.]+)+)\s+(?:hit|hits|scored|smacked|clubbed|muscle[ds]?)\s+(\d+)\s+off\s+\d+\s+balls?\b/gi;
  const offFound = new Set<string>();
  while ((m = offBallsRe.exec(t)) !== null) {
    const runs = parseInt(safeString(m[2]), 10);
    if (!Number.isFinite(runs) || runs < 35) continue;
    const n = safeString(m[1]);
    if (n && !isPlaceholderMomName(n)) offFound.add(n);
  }
  if (offFound.size === 1) return [...offFound][0] ?? null;

  return null;
}

function tryMomFromDdgBlobs(blobs: string[]): string | null {
  for (const blob of blobs) {
    const mom = extractMomFromFreeText(blob);
    if (mom) return mom;
  }
  const merged = blobs.join(" \n ").replace(/\s+/g, " ");
  const fromPhrases = extractMomFromFreeText(merged);
  if (fromPhrases) return fromPhrases;
  return extractMomFromBattingHighlights(merged);
}

function extractDdgResultTexts(html: string): string[] {
  const seen = new Set<string>();
  const texts: string[] = [];
  const patterns = [
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
    /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
    /<a[^>]*class="[^"]*result-link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
    /<a[^>]*class="[^"]*result__url[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
    /<div[^>]*class="[^"]*web-result[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, "gi");
    while ((m = r.exec(html)) !== null) {
      const inner = stripHtml(m[1] ?? "").replace(/\s+/g, " ").trim();
      if (inner.length > 12 && !seen.has(inner)) {
        seen.add(inner);
        texts.push(inner);
      }
    }
  }
  return texts;
}

function ddgHtmlLooksLikeResults(body: string): boolean {
  return (
    body.includes("result__a") ||
    body.includes("result__snippet") ||
    body.includes("result-link") ||
    body.includes("web-result")
  );
}

async function fetchDdgHtml(query: string): Promise<string | null> {
  const headers: HeadersInit = {
    "User-Agent": BROWSER_UA,
    Accept: "text/html",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://duckduckgo.com/",
  };
  // POST often returns fuller HTML from server-side fetchers (e.g. Vercel) than GET.
  let res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    cache: "no-store",
    headers: {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ q: query }).toString(),
    redirect: "follow",
  });
  if (res.ok) {
    const body = await res.text();
    if (ddgHtmlLooksLikeResults(body)) return body;
  }
  const getUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  res = await fetch(getUrl, { cache: "no-store", headers, redirect: "follow" });
  if (!res.ok) return null;
  return res.text();
}

/**
 * Build a web search query similar to a manual Google search, e.g.
 * "KKR vs SRH Apr 2 2026 IPL mom man of the match".
 */
export function buildMomWebSearchQuery(fixtureFull: string, isoDate: string): string {
  const short = formatFixture(fixtureFull) || fixtureFull.trim();
  const teamsOnly = stripMatchSuffix(short) || short;
  const dateHuman = humanizeIsoDateForSearch(isoDate);
  const parts = [teamsOnly, dateHuman, "IPL", "mom", "man of the match"].filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Extra DDG queries when the primary one returns no explicit MoM phrase in snippets. */
export function buildMomSearchQueryVariations(fixtureFull: string, isoDate: string): string[] {
  const primary = buildMomWebSearchQuery(fixtureFull, isoDate);
  const short = formatFixture(fixtureFull) || fixtureFull.trim();
  const teamsOnly = stripMatchSuffix(short) || short;
  const dateHuman = humanizeIsoDateForSearch(isoDate);
  const extra = [
    `${teamsOnly} ${dateHuman} IPL player of the match`.trim(),
    `${teamsOnly} ${dateHuman} IPL POTM`.trim(),
    `${teamsOnly} ${dateHuman} IPL man of the match winner`.trim(),
    `${teamsOnly} ${dateHuman} IPL match report highlights`.trim(),
  ].filter((q) => q.length > 8);
  return [...new Set([primary, ...extra])];
}

/**
 * Full MoM web path for a fixture: try several DDG queries, regex + recap headline heuristic, then optional AI.
 */
export async function searchWebForMomForFixture(fixtureFull: string, isoDate: string): Promise<string | null> {
  const queries = buildMomSearchQueryVariations(fixtureFull, isoDate);
  if (queries.length === 0) return null;
  try {
    const allBlobs: string[] = [];
    const seenBlob = new Set<string>();

    for (let i = 0; i < queries.length; i++) {
      const q = queries[i]!;
      const html = await fetchDdgHtml(q);
      if (!html) continue;
      const blobs = extractDdgResultTexts(html);
      const mom = tryMomFromDdgBlobs(blobs);
      if (mom) return mom;
      for (const b of blobs) {
        if (!seenBlob.has(b)) {
          seenBlob.add(b);
          allBlobs.push(b);
        }
      }
      if (i < queries.length - 1) {
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    if (allBlobs.length === 0) return null;
    const mergedAll = allBlobs.join(" \n ").replace(/\s+/g, " ");
    const fromPhrases = extractMomFromFreeText(mergedAll);
    if (fromPhrases) return fromPhrases;
    const fromHighlights = extractMomFromBattingHighlights(mergedAll);
    if (fromHighlights) return fromHighlights;

    return inferMomFromSnippetsWithAi({ searchQuery: queries[0]!, snippets: allBlobs });
  } catch {
    return null;
  }
}

/** Single-query MoM search (used by scripts / callers that already built a query string). */
export async function searchWebForMom(query: string): Promise<string | null> {
  if (!query.trim()) return null;
  try {
    const html = await fetchDdgHtml(query);
    if (!html) return null;
    const blobs = extractDdgResultTexts(html);
    const mom = tryMomFromDdgBlobs(blobs);
    if (mom) return mom;
    return inferMomFromSnippetsWithAi({ searchQuery: query, snippets: blobs });
  } catch {
    return null;
  }
}
