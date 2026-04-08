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
    /\bm\.?\s*o\.?\s*m\.?\s*:?\s*([^,.|]+?)(?:\s*[,.|]|$)/i,
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

function extractDdgResultTexts(html: string): string[] {
  const texts: string[] = [];
  const res = [/<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi];
  for (const re of res) {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, "gi");
    while ((m = r.exec(html)) !== null) {
      const inner = stripHtml(m[1] ?? "").replace(/\s+/g, " ").trim();
      if (inner.length > 12) texts.push(inner);
    }
  }
  return texts;
}

async function fetchDdgHtml(query: string): Promise<string | null> {
  const headers: HeadersInit = {
    "User-Agent": BROWSER_UA,
    Accept: "text/html",
    "Accept-Language": "en-US,en;q=0.9",
  };
  const getUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  let res = await fetch(getUrl, { cache: "no-store", headers, redirect: "follow" });
  if (res.ok) {
    const body = await res.text();
    if (body.includes("result__a") || body.includes("result__snippet")) return body;
  }
  res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    cache: "no-store",
    headers: {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ q: query }).toString(),
    redirect: "follow",
  });
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

export async function searchWebForMom(query: string): Promise<string | null> {
  if (!query.trim()) return null;
  try {
    const html = await fetchDdgHtml(query);
    if (!html) return null;
    const blobs = extractDdgResultTexts(html);
    for (const blob of blobs) {
      const mom = extractMomFromFreeText(blob);
      if (mom) return mom;
    }
    const merged = blobs.join(" \n ").replace(/\s+/g, " ");
    const fromMerge = extractMomFromFreeText(merged);
    if (fromMerge) return fromMerge;
    return inferMomFromSnippetsWithAi({ searchQuery: query, snippets: blobs });
  } catch {
    return null;
  }
}
