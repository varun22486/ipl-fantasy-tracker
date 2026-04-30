/**
 * Optional fallback when CricAPI returns no match_scorecard payload (free — no extra API key).
 * Scrapes the public Cricbuzz Next.js scorecard page and extracts embedded `scorecardApiData` JSON
 * (same idea as community scrapers). Enable with CRICKET_CRICBUZZ_FALLBACK=1.
 *
 * Cricbuzz may change markup; this can break without notice. Respect their terms of use.
 */

type MaybeRecord = Record<string, unknown>;

const DEFAULT_SERIES_MATCHES_URL =
  "https://www.cricbuzz.com/cricket-series/8736/indian-premier-league-2026/matches";

const CB_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.cricbuzz.com/",
  Accept: "text/html,*/*",
};

const HTTP_MS = (() => {
  const n = Number(process.env.CRICKET_HTTP_TIMEOUT_MS);
  if (Number.isFinite(n) && n >= 8_000 && n <= 120_000) return Math.floor(n);
  return 28_000;
})();

function cleanEnvText(value: string | undefined | null) {
  return (value || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

/** Like Python str.encode().decode("unicode_escape") for our flight literals. */
function decodeUnicodeEscapes(raw: string): string {
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== "\\") {
      out.push(c);
      continue;
    }
    if (i + 1 >= raw.length) {
      out.push("\\");
      break;
    }
    const n = raw[++i];
    switch (n) {
      case "n":
        out.push("\n");
        break;
      case "r":
        out.push("\r");
        break;
      case "t":
        out.push("\t");
        break;
      case '"':
        out.push('"');
        break;
      case "\\":
        out.push("\\");
        break;
      case "u": {
        const hex = raw.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out.push(String.fromCodePoint(parseInt(hex, 16)));
          i += 4;
        } else {
          out.push("u");
        }
        break;
      }
      default:
        out.push(n);
        break;
    }
  }
  return out.join("");
}

const IPL_NAME_TO_SLUG: [string, string][] = [
  ["chennai super kings", "csk"],
  ["mumbai indians", "mi"],
  ["kolkata knight riders", "kkr"],
  ["royal challengers bengaluru", "rcb"],
  ["royal challengers bangalore", "rcb"],
  ["sunrisers hyderabad", "srh"],
  ["delhi capitals", "dc"],
  ["punjab kings", "pbks"],
  ["rajasthan royals", "rr"],
  ["gujarat titans", "gt"],
  ["lucknow super giants", "lsg"],
];

function teamSlugHintsFromFixture(fixture: string): string[] {
  const lower = fixture.toLowerCase();
  const out: string[] = [];
  for (const [namePart, slug] of IPL_NAME_TO_SLUG) {
    if (lower.includes(namePart)) out.push(slug);
  }
  return out;
}

function listCricbuzzMatchesFromSeriesHtml(html: string): Array<{ id: string; slug: string }> {
  const re = /\/live-cricket-scores\/(\d+)\/([a-z0-9-]+)/gi;
  const seen = new Set<string>();
  const rows: Array<{ id: string; slug: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    const slug = m[2].toLowerCase();
    const key = `${id}|${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ id, slug });
  }
  return rows;
}

function pickCricbuzzMatchId(rows: Array<{ id: string; slug: string }>, hints: string[]): string | null {
  if (rows.length === 0 || hints.length === 0) return null;
  const want = [...new Set(hints.map((h) => h.toLowerCase()))];
  let bestId: string | null = null;
  let bestScore = 0;
  for (const r of rows) {
    let score = 0;
    for (const h of want) {
      if (r.slug.includes(h)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = r.id;
    }
  }
  if (bestScore < Math.min(2, want.length)) return null;
  return bestId;
}

function extractBraceObject(jsonStr: string, keyPos: number): string | null {
  const braceStart = jsonStr.indexOf("{", keyPos);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < jsonStr.length; i++) {
    const c = jsonStr[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return jsonStr.slice(braceStart, i + 1);
    }
  }
  return null;
}

export function extractScorecardApiDataFromCricbuzzScorecardHtml(html: string): MaybeRecord | null {
  const marker = "scorecardApiData";
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  const pushStart = html.lastIndexOf("self.__next_f.push", idx);
  if (pushStart === -1) return null;

  const chunk = html.slice(pushStart);
  const innerStart = chunk.indexOf('"') + 1;
  if (innerStart <= 0) return null;

  let endIdx = chunk.indexOf('"]\n', innerStart);
  if (endIdx === -1) endIdx = chunk.indexOf('"]\r\n', innerStart);
  if (endIdx === -1) endIdx = chunk.indexOf('"])', innerStart);
  if (endIdx === -1) return null;

  const rawEscaped = chunk.slice(innerStart, endIdx);
  let jsonStr: string;
  try {
    jsonStr = decodeUnicodeEscapes(rawEscaped);
  } catch {
    return null;
  }

  const scIdx = jsonStr.indexOf(marker);
  if (scIdx === -1) return null;

  const objText = extractBraceObject(jsonStr, scIdx);
  if (!objText) return null;

  try {
    return JSON.parse(objText) as MaybeRecord;
  } catch {
    return null;
  }
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return 0;
}

/** Shape compatible with collectPlayerRows in cricket-provider.ts */
export function cricbuzzScorecardApiDataToProviderTree(apiData: MaybeRecord): MaybeRecord {
  const scoreCard = apiData.scoreCard;
  if (!Array.isArray(scoreCard)) return { scorecard: [] };

  const inningsOut: MaybeRecord[] = [];
  for (const inn of scoreCard) {
    if (!inn || typeof inn !== "object") continue;
    const o = inn as MaybeRecord;
    const batting: MaybeRecord[] = [];
    const batTeam = o.batTeamDetails as MaybeRecord | undefined;
    const batsmenData = batTeam?.batsmenData as MaybeRecord | undefined;
    if (batsmenData && typeof batsmenData === "object") {
      for (const b of Object.values(batsmenData)) {
        if (!b || typeof b !== "object") continue;
        const br = b as MaybeRecord;
        const name = typeof br.batName === "string" ? br.batName.trim() : "";
        if (!name) continue;
        batting.push({ batsman: name, r: num(br.runs) });
      }
    }

    const bowling: MaybeRecord[] = [];
    const bowlTeam = o.bowlTeamDetails as MaybeRecord | undefined;
    const bowlersData = bowlTeam?.bowlersData as MaybeRecord | undefined;
    if (bowlersData && typeof bowlersData === "object") {
      for (const bw of Object.values(bowlersData)) {
        if (!bw || typeof bw !== "object") continue;
        const w = bw as MaybeRecord;
        const name = typeof w.bowlName === "string" ? w.bowlName.trim() : "";
        if (!name) continue;
        bowling.push({ bowler: name, w: num(w.wickets) });
      }
    }

    inningsOut.push({ batting, bowling });
  }

  return { scorecard: inningsOut };
}

export async function tryCricbuzzScorecardFallback(
  fixtureLabel: string
): Promise<{ matchId: string; tree: MaybeRecord } | null> {
  const label = cleanEnvText(fixtureLabel);
  if (!label) return null;

  const hints = teamSlugHintsFromFixture(label);
  if (hints.length < 2) return null;

  const seriesUrl = cleanEnvText(process.env.CRICKET_CRICBUZZ_SERIES_MATCHES_URL) || DEFAULT_SERIES_MATCHES_URL;

  let seriesHtml: string;
  try {
    const r = await fetch(seriesUrl, {
      headers: CB_HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(HTTP_MS),
    });
    if (!r.ok) return null;
    seriesHtml = await r.text();
  } catch {
    return null;
  }

  const links = listCricbuzzMatchesFromSeriesHtml(seriesHtml);
  const matchId = pickCricbuzzMatchId(links, hints);
  if (!matchId) return null;

  const scorecardUrl = `https://www.cricbuzz.com/live-cricket-scorecard/${matchId}`;
  let pageHtml: string;
  try {
    const r2 = await fetch(scorecardUrl, {
      headers: CB_HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(HTTP_MS),
    });
    if (!r2.ok) return null;
    pageHtml = await r2.text();
  } catch {
    return null;
  }

  const apiData = extractScorecardApiDataFromCricbuzzScorecardHtml(pageHtml);
  if (!apiData) return null;

  const tree = cricbuzzScorecardApiDataToProviderTree(apiData);
  return { matchId, tree };
}
