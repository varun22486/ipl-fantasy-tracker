import { createClient } from "@supabase/supabase-js";

const DEFAULT_BASE_URL = "https://api.cricapi.com";

// ---------------------------------------------------------------------------
// Per-key hit tracking (fire-and-forget, never blocks the main request)
// ---------------------------------------------------------------------------
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function recordKeyHit(alias: string) {
  const db = getAdminClient();
  if (!db) return;
  const today = new Date().toISOString().slice(0, 10);
  await db.rpc("increment_key_hit", { p_alias: alias, p_date: today });
}

/** Non-blocking — caller must not await this. */
function trackKeyHit(key: string) {
  recordKeyHit(keyAlias(key)).catch(() => {/* ignore tracking failures */});
}

type MaybeRecord = Record<string, any>;

export type MatchSeed = {
  externalMatchId?: string;
  match_date: string;
  label: string;
  fixture: string;
  venue?: string | null;
  toss_winner?: string | null;
  status: string;
  live_summary?: string | null;
  source_url?: string | null;
};

export type PlayerStats = {
  name: string;
  runs: number;
  wickets: number;
  catches: number;
  fifty_bonus: number;
  hundred_bonus: number;
  three_w_bonus: number;
  five_w_bonus: number;
};

export type SquadTeam = {
  teamName: string;
  players: string[];
};

export type ProviderRefresh = {
  status?: string;
  live_summary?: string | null;
  fixture?: string;
  venue?: string | null;
  toss_winner?: string | null;
  source_url?: string | null;
  players: PlayerStats[];
  /** Playing squads / XI from provider when available */
  squads: SquadTeam[];
  /** Flat unique names for lineup picker */
  rosterNames: string[];
  raw?: MaybeRecord;
};

function cleanEnvText(value: string | undefined | null) {
  return (value || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

function envBaseUrl() {
  return cleanEnvText(process.env.CRICKET_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function isLegacySeedEndpoint(baseUrl: string) {
  return /\/api\/seed$/i.test(baseUrl);
}

function allApiKeys(): string[] {
  return [
    cleanEnvText(process.env.CRICKET_API_KEY),
    cleanEnvText(process.env.CRICKET_API_KEY_2),
    cleanEnvText(process.env.CRICKET_API_KEY_3),
  ].filter(Boolean) as string[];
}

/** Short alias shown in stats (first 8 chars of key). */
function keyAlias(key: string): string {
  return key.slice(0, 8);
}

function isQuotaError(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;
  if (payload.status !== "failure") return false;
  const r = String(payload.reason || payload.message || "").toLowerCase();
  // CricAPI returns "Blocked for 15 minutes" for rate-limit and
  // "Exceeded hits limit" for daily quota — treat both as skip-to-next-key
  return (
    r.includes("exceeded") ||
    r.includes("limit") ||
    r.includes("block") ||   // "Blocked for 15 minutes"
    r.includes("credits") ||
    r.includes("quota")
  );
}

/** Returns true when an error message indicates all API keys are quota-exhausted. */
function isQuotaErrorMsg(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("exceeded") ||
    m.includes("block") ||
    m.includes("quota") ||
    m.includes("credits") ||
    m.includes("all keys failed")
  );
}

function isCricapiBase(baseUrl: string) {
  return /api\.cricapi\.com$/i.test(baseUrl);
}

function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const rapidHost = cleanEnvText(process.env.CRICKET_API_HOST);
  if (rapidHost && apiKey) {
    headers["X-RapidAPI-Key"] = apiKey;
    headers["X-RapidAPI-Host"] = rapidHost;
  }
  return headers;
}

function injectKey(path: string, apiKey: string): string {
  if (!apiKey) return path;
  if (/([?&])apikey=/i.test(path)) return path;
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}apikey=${encodeURIComponent(apiKey)}`;
}

/**
 * Tries each API key ordered by today's hit count (least-used first),
 * falling back to the next one if the current key is over quota.
 * Throws only when all keys are exhausted.
 */
async function fetchJson(path: string) {
  const baseUrl = envBaseUrl();
  const keys = allApiKeys();

  // Order by ascending hit count so the least-used key goes first;
  // ties broken randomly so load is spread across equally-fresh keys.
  const today = new Date().toISOString().slice(0, 10);
  const hitsToday = await (async () => {
    try {
      const db = getAdminClient();
      if (!db) return {} as Record<string, number>;
      const { data } = await db
        .from("api_key_stats")
        .select("key_alias, hits")
        .eq("stat_date", today);
      const map: Record<string, number> = {};
      for (const row of data ?? []) map[row.key_alias as string] = row.hits as number;
      return map;
    } catch { return {} as Record<string, number>; }
  })();

  const ordered = [...keys].sort((a, b) => {
    const da = hitsToday[keyAlias(a)] ?? 0;
    const db2 = hitsToday[keyAlias(b)] ?? 0;
    return da !== db2 ? da - db2 : Math.random() - 0.5;
  });
  if (ordered.length === 0) ordered.push("");

  let lastError = "";
  for (const key of ordered) {
    const requestPath = isCricapiBase(baseUrl) ? injectKey(path, key) : path;
    const headers = buildHeaders(key);
    const response = await fetch(`${baseUrl}${requestPath}`, { headers, cache: "no-store" });
    if (!response.ok) {
      lastError = `HTTP ${response.status}`;
      continue;
    }
    const payload = await response.json();
    // Always track the hit — even quota errors count against the CricAPI server limit.
    // Tracking failures lets the DB reflect real usage and prevents invisible quota burn.
    trackKeyHit(key);
    if (isQuotaError(payload)) {
      lastError = String(payload.reason || "quota exceeded");
      continue; // try next key
    }
    return payload;
  }

  throw new Error(`Cricket API error: ${lastError || "all keys failed"}`);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** IPL calendar day for filtering double-headers and completed games. */
const IPL_TZ = "Asia/Kolkata";

function formatDateInTimeZone(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (y && m && day) return `${y}-${m}-${day}`;
  return d.toISOString().slice(0, 10);
}

function todayIsoInIplTZ(): string {
  return formatDateInTimeZone(new Date(), IPL_TZ);
}

function extractProviderMatchDate(match: MaybeRecord): string | null {
  const asIso = (raw: string) => {
    const s = raw.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };

  const direct = asIso(safeString(match.date || match.matchDate || match.match_date));
  if (direct) return direct;

  const gmt = asIso(safeString(match.dateTimeGMT));
  if (gmt) return gmt;

  const started = asIso(safeString(match.startedAt || match.startDate));
  if (started) return started;

  const tp = match.timeAndPlace;
  if (tp && typeof tp === "object") {
    const d = asIso(safeString((tp as any).date));
    if (d) return d;
  }

  const ms =
    typeof match.ms === "number" && match.ms > 0
      ? match.ms
      : typeof match.dateTime === "number" && match.dateTime > 0
        ? match.dateTime
        : NaN;
  if (Number.isFinite(ms)) return formatDateInTimeZone(new Date(ms), IPL_TZ);

  return null;
}

/** Include fixtures for the India calendar day: dated rows must match; undated rows use status heuristics. */
function isMatchOnIplCalendarDay(match: MaybeRecord, dayIso: string): boolean {
  const d = extractProviderMatchDate(match);
  if (d) return d === dayIso;

  const st = safeString(match.status || match.state || match.overview).toLowerCase();
  if (st.includes("tomorrow")) return false;
  if (st.includes("yesterday")) return false;
  if (st.includes("live")) return true;
  if (st.includes("won") || st.includes("beat") || st.includes("tie") || st.includes("no result") || st.includes("abandon")) return true;
  if (st.includes("toss") || st.includes("opt to") || st.includes("innings")) return true;
  if (st.includes("scheduled") || st.includes("starts") || st.includes("pm ist") || st.includes("am ist")) return true;
  return true;
}

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseStatus(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("live") || lower.includes("need") || lower.includes("won toss")) return "LIVE";
  if (lower.includes("won by") || lower.includes("beat") || lower.includes("drew") || lower.includes("tie")) return "COMPLETED";
  if (lower.includes("tomorrow") || lower.includes("upcoming") || lower.includes("starts") || lower.includes("vs")) return "SCHEDULED";
  return text ? text.toUpperCase() : "LIVE";
}

function sanitizeLabelPart(s: string) {
  return s.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
}

function matchToSeed(match: MaybeRecord): MatchSeed {
  const title = safeString(match.title || match.fixture || match.name || match.matchDesc || match.seriesAdWrapper?.matchInfo?.matchDesc);
  const teams = Array.isArray(match.teams)
    ? match.teams
        .map((t: any) => safeString(typeof t === "string" ? t : t.team || t.teamName || t.name || t.teamSName))
        .filter(Boolean)
        .join(" vs ")
    : "";
  const fixture = title.replace(/,\s*$/, "") || teams || "IPL Match";
  const overview = safeString(match.overview || match.status || match.state || match.statusText);
  const place = safeString(match.timeAndPlace?.place || match.venue || match.ground || match.venueInfo?.ground || match.venueInfo?.city);
  const sourceUrl = safeString(match.url || match.source_url);
  const extId = safeString(match.id || match.matchId || match.match_id);
  const match_date = extractProviderMatchDate(match) || todayIsoInIplTZ();
  // Use a human-readable fixture name in the label; fall back to external ID for uniqueness
  const fixtureSlug = fixture !== "IPL Match"
    ? sanitizeLabelPart(fixture.replace(/,\s*\d+\w*\s*(Match|T20|ODI|Test).*$/i, "").trim()).slice(0, 80)
    : "";
  const uniquePart = fixtureSlug || sanitizeLabelPart(extId) || String(Date.now());
  const labelBase = `${sanitizeLabelPart(match_date)}_${uniquePart}`;

  return {
    externalMatchId: extId,
    match_date,
    label: labelBase.slice(0, 240),
    fixture,
    venue: place || null,
    toss_winner: null,
    status: parseStatus(overview || fixture),
    live_summary: overview || null,
    source_url: sourceUrl || null,
  };
}

const IPL_TEAMS = [
  "Chennai Super Kings",
  "Delhi Capitals",
  "Gujarat Titans",
  "Kolkata Knight Riders",
  "Lucknow Super Giants",
  "Mumbai Indians",
  "Punjab Kings",
  "Rajasthan Royals",
  "Royal Challengers Bengaluru",
  "Royal Challengers Bangalore",
  "Sunrisers Hyderabad",
];

/** Short codes / nicknames often present in API text */
const IPL_MARKERS = [
  "tata ipl",
  "indian premier league",
  " ipl ",
  "ipl 20",
  "ipl,",
  "ipl-",
];

function teamsText(match: MaybeRecord): string {
  if (!Array.isArray(match.teams)) return "";
  return match.teams
    .map((t: any) => {
      if (typeof t === "string") return t;
      return safeString(t.team || t.teamName || t.name || t.teamSName || t.shortname || t.shortName);
    })
    .filter(Boolean)
    .join(" ");
}

const IPL_VENUES = [
  "eden gardens", "wankhede", "chepauk", "chidambaram", "chinnaswamy",
  "narendra modi", "rajiv gandhi", "arun jaitley", "feroz shah kotla",
  "ekana", "barsapara", "himachal pradesh cricket", "jsca", "sawai mansingh",
];

const IPL_CODES = ["csk", "mi", "kkr", "rcb", "rr", "dc", "srh", "pbks", "gt", "lsg"];

function isProbablyIplMatch(match: MaybeRecord) {
  const teamInfoText = Array.isArray(match.teamInfo)
    ? match.teamInfo
        .map((t: any) => safeString(t.name || t.shortname || t.shortName || t.teamName))
        .join(" ")
    : "";

  const blob = [
    safeString(match.name),
    safeString(match.title),
    safeString(match.matchDesc),
    safeString(match.series),
    safeString(match.seriesName),
    safeString(match.series_name),
    safeString(match.leagueName),
    safeString(match.competitionName),
    safeString(match.matchType),
    safeString(match.type),
    safeString(match.status),
    safeString(match.venue),
    safeString(match.ground),
    teamsText(match),
    teamInfoText,
  ]
    .join(" ")
    .toLowerCase();

  // Any marker phrase
  if (IPL_MARKERS.some((m) => blob.includes(m))) return true;
  // "ipl" as a standalone word anywhere (catches "IPL 2025", "Tata IPL", etc.)
  if (/\bipl\b/.test(blob)) return true;

  // 2+ full team names
  const teamHits = IPL_TEAMS.filter((t) => blob.includes(t.toLowerCase())).length;
  if (teamHits >= 2) return true;

  // 2+ short codes
  const codeHits = IPL_CODES.filter((c) => new RegExp(`\\b${c}\\b`, "i").test(blob)).length;
  if (codeHits >= 2) return true;

  // 1 team name/code + known IPL venue (strong signal)
  const hasIplVenue = IPL_VENUES.some((v) => blob.includes(v));
  if (hasIplVenue && (teamHits >= 1 || codeHits >= 1)) return true;

  return false;
}

function isProbablyIplFromSeed(seed: MatchSeed) {
  const blob = `${seed.fixture} ${seed.live_summary || ""} ${seed.venue || ""}`.toLowerCase();
  if (IPL_MARKERS.some((m) => blob.includes(m))) return true;
  if (IPL_TEAMS.filter((t) => blob.includes(t.toLowerCase())).length >= 2) return true;
  const codes = ["csk", "mi", "kkr", "rcb", "rr", "dc", "srh", "pbks", "gt", "lsg"];
  return codes.filter((c) => new RegExp(`\\b${c}\\b`, "i").test(blob)).length >= 2;
}

function pickBestIplMatch(matches: MaybeRecord[]) {
  const iplOnly = matches.filter(isProbablyIplMatch);
  if (iplOnly.length === 0) return null;

  const scored = iplOnly
    .map((match, index) => {
      let score = 0;
      const text = [safeString(match.name), safeString(match.status), safeString(match.matchType), safeString(match.series), safeString(match.seriesName)]
        .join(" ")
        .toLowerCase();
      if (text.includes("live")) score += 30;
      if (text.includes("t20")) score += 10;
      if (text.includes("schedule") || text.includes("upcoming")) score -= 5;
      return { match, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return scored[0]?.match ?? null;
}

async function fetchMatchArray(path: string): Promise<MaybeRecord[]> {
  const payload = await fetchJson(path);

  // Surface quota / auth failures instead of silently returning []
  if (payload && typeof payload === "object" && payload.status === "failure") {
    const reason = safeString(payload.reason || payload.message || "API error");
    throw new Error(`Cricket API error: ${reason}`);
  }

  const matches = payload?.data?.matches || payload?.data || payload?.matches || [];
  return Array.isArray(matches) ? matches : [];
}

// Known IPL series IDs — update CRICKET_IPL_SERIES_ID env var each new season
// or just add the new ID here.
const KNOWN_IPL_SERIES_IDS = [
  "87c62aac-bc3c-4738-ab93-19da0690488f", // IPL 2026
];

/**
 * Fetches IPL matches for a 3-day window: yesterday, today, tomorrow (IST).
 * This lets users link yesterday's completed match or pre-link tomorrow's upcoming one.
 * Costs 1 API credit.
 */
async function fetchIplSeriesMatchesForToday(seriesId: string): Promise<MaybeRecord[]> {
  const payload = await fetchJson(`/v1/series_info?id=${encodeURIComponent(seriesId)}`);
  const matchList: MaybeRecord[] = Array.isArray(payload?.data?.matchList) ? payload.data.matchList : [];
  if (matchList.length === 0) return [];

  const nowMs = Date.now();
  const today = formatDateInTimeZone(new Date(nowMs), IPL_TZ);
  const yesterday = formatDateInTimeZone(new Date(nowMs - 86_400_000), IPL_TZ);
  const tomorrow = formatDateInTimeZone(new Date(nowMs + 86_400_000), IPL_TZ);

  const window = matchList.filter((m) => {
    const d = extractProviderMatchDate(m);
    return d === yesterday || d === today || d === tomorrow;
  });

  if (window.length > 0) return window;

  // Fallback: up to 2 most recent past matches
  const past = matchList
    .filter((m) => {
      const d = extractProviderMatchDate(m);
      return d && d <= today;
    })
    .sort((a, b) => (extractProviderMatchDate(b) ?? "").localeCompare(extractProviderMatchDate(a) ?? ""));

  return past.slice(0, 2);
}

async function collectRawMatchesFromProvider(): Promise<MaybeRecord[]> {
  const baseUrl = envBaseUrl();
  const seen = new Set<string>();
  const out: MaybeRecord[] = [];

  const absorb = (arr: MaybeRecord[]) => {
    for (const m of arr) {
      const id = safeString(m.id || m.matchId || m.match_id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(m);
    }
  };

  if (isCricapiBase(baseUrl)) {
    // Always fetch the IPL series first so today's match is always available,
    // even if CricAPI's currentMatches feed is slow to add new IPL seasons.
    const envSeriesId = cleanEnvText(process.env.CRICKET_IPL_SERIES_ID);
    const seriesIds = envSeriesId ? [envSeriesId, ...KNOWN_IPL_SERIES_IDS] : KNOWN_IPL_SERIES_IDS;
    for (const seriesId of seriesIds) {
      try {
        const seriesMatches = await fetchIplSeriesMatchesForToday(seriesId);
        absorb(seriesMatches);
        if (seriesMatches.length > 0) break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Quota exhaustion means all keys are spent — bubble up immediately
        if (isQuotaErrorMsg(msg)) throw err;
        // Other errors (bad series ID, network blip): try next series
      }
    }

    try {
      absorb(await fetchMatchArray("/v1/currentMatches?offset=0"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isQuotaErrorMsg(msg)) throw err; // propagate quota errors
      // best-effort; series already has IPL data
    }
  } else {
    const paths = ["/v1/matches/live?type=league", "/v1/matches/recent?type=league", "/v1/matches/upcoming?type=league"];
    const batches = await Promise.all(paths.map((p) => fetchMatchArray(p).catch(() => [] as MaybeRecord[])));
    for (const arr of batches) absorb(arr);
  }

  return out;
}

function choiceDisplayOrder(a: MatchSeed, b: MatchSeed): number {
  const rank = (s: MatchSeed) => {
    const t = `${s.status} ${s.live_summary || ""}`.toLowerCase();
    if (t.includes("live")) return 0;
    if (t.includes("schedul") || t.includes("upcoming")) return 2;
    return 1;
  };
  const dr = rank(a) - rank(b);
  if (dr !== 0) return dr;
  return a.fixture.localeCompare(b.fixture);
}

/** All IPL fixtures currently in the feed (live, recent, upcoming). */
export async function getIplMatchChoicesForToday(): Promise<{
  choices: MatchSeed[];
  totalRaw: number;
  nonIplSample: string[];
}> {
  const raw = await collectRawMatchesFromProvider();
  const ipl = raw.filter(isProbablyIplMatch);
  const byId = new Map<string, MatchSeed>();
  for (const m of ipl) {
    const s = matchToSeed(m);
    if (s.externalMatchId && !byId.has(s.externalMatchId)) byId.set(s.externalMatchId, s);
  }
  // Sample of what IS in the feed so users can see why IPL wasn't found
  const nonIplSample = raw
    .filter((m) => !isProbablyIplMatch(m))
    .slice(0, 5)
    .map((m) => safeString(m.name || m.title || m.matchDesc) || "Unknown match");

  return {
    choices: [...byId.values()].sort(choiceDisplayOrder),
    totalRaw: raw.length,
    nonIplSample,
  };
}

/**
 * Resolves any CricAPI match ID the user explicitly picked from our IPL picker.
 * - First checks the recent feed (yesterday/today/tomorrow window).
 * - Falls back to a direct match_info lookup which works for any match,
 *   including completed ones that have aged out of the live feed.
 * - The IPL check is intentionally skipped on the direct lookup because the
 *   user already selected the match from our filtered IPL picker.
 */
export async function getMatchSeedByExternalIdForToday(externalMatchId: string): Promise<MatchSeed | null> {
  const id = cleanEnvText(externalMatchId);
  if (!id) return null;

  // Fast path: match still in the recent feed
  const raw = await collectRawMatchesFromProvider();
  const hit = raw.find((m) => safeString(m.id || m.matchId || m.match_id) === id);
  if (hit && isProbablyIplMatch(hit)) return matchToSeed(hit);

  // Slow path: direct match_info lookup (works for any past/future match)
  if (isCricapiBase(envBaseUrl())) {
    try {
      const payload = await fetchJson(`/v1/match_info?id=${encodeURIComponent(id)}`);
      const m = payload?.data ?? payload;
      if (m && typeof m === "object" && !Array.isArray(m) && safeString((m as MaybeRecord).id || id)) {
        // Trust the selection — user picked it from our IPL-filtered picker
        return matchToSeed({ ...(m as MaybeRecord), id });
      }
    } catch {
      // ignore — will fall through to null
    }
  }

  return null;
}

async function getLegacySeedMatch(baseUrl: string): Promise<MatchSeed | null> {
  if (!isLegacySeedEndpoint(baseUrl)) return null;

  const response = await fetch(baseUrl, {
    headers: authHeaders(),
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    throw new Error(`Legacy seed endpoint failed: ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.ok && payload?.match) {
    return matchToSeed(payload.match);
  }

  if (payload?.match) {
    return matchToSeed(payload.match);
  }

  throw new Error("Legacy seed endpoint did not return { match: ... }.");
}

export async function getBestLeagueMatch(): Promise<MatchSeed> {
  const baseUrl = envBaseUrl();

  if (isLegacySeedEndpoint(baseUrl)) {
    const seeded = await getLegacySeedMatch(baseUrl);
    if (seeded) {
      if (!isProbablyIplFromSeed(seeded)) {
        throw new Error(
          "Linked match does not look like IPL (Indian Premier League). Use api.cricapi.com as CRICKET_API_BASE_URL or fix your seed payload."
        );
      }
      return seeded;
    }
  }

  const raw = await collectRawMatchesFromProvider();
  const iplMatches = raw.filter(isProbablyIplMatch);
  const picked = pickBestIplMatch(iplMatches);
  if (picked) return matchToSeed(picked);
  if (iplMatches.length > 0) return matchToSeed(iplMatches[0]);

  const day = todayIsoInIplTZ();
  throw new Error(
    raw.length === 0
      ? `Cricket API returned no matches — quota may be exhausted or rate-limited. Wait 15 minutes and try again, or check your plan at cricketdata.org.`
      : `No IPL match found in the feed (${raw.length} non-IPL matches returned). IPL season may not have started yet, or try Sync Scores Now.`
  );
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = value.match(/-?\d+/);
    if (match) return Number(match[0]);
  }
  return 0;
}

function bonusify(row: PlayerStats): PlayerStats {
  return {
    ...row,
    fifty_bonus: row.runs >= 50 ? 1 : 0,
    hundred_bonus: row.runs >= 100 ? 1 : 0,
    three_w_bonus: row.wickets >= 3 ? 1 : 0,
    five_w_bonus: row.wickets >= 5 ? 1 : 0,
  };
}

function collectPlayerRows(node: any, bucket: PlayerStats[]) {
  if (!node) return;

  if (Array.isArray(node)) {
    // Old-format catching array: [{ catcher: {name}, catch: 1 }, ...]
    // Aggregate per player into a SINGLE row each so Math.max merge is correct.
    const isCatchingArr = node.length > 0 && node.every(
      (item: any) => item && typeof item === "object" && ("catcher" in item || "catch" in item)
    );
    if (isCatchingArr) {
      const acc = new Map<string, { name: string; total: number }>();
      for (const item of node) {
        const n = playerName(item.catcher);
        if (!n) continue;
        const k = n.toLowerCase();
        const c = numberValue(item["catch"] ?? 0);
        if (c <= 0) continue;
        if (!acc.has(k)) acc.set(k, { name: n, total: 0 });
        acc.get(k)!.total += c;
      }
      for (const { name, total } of acc.values()) {
        bucket.push(bonusify({ name, runs: 0, wickets: 0, catches: total, fifty_bonus: 0, hundred_bonus: 0, three_w_bonus: 0, five_w_bonus: 0 }));
      }
      return;
    }
    for (const item of node) collectPlayerRows(item, bucket);
    return;
  }

  if (typeof node !== "object") return;

  // Extract player name from either string or nested object { id, name }
  function playerName(field: any): string | null {
    if (typeof field === "string" && field.trim()) return field.trim();
    if (field && typeof field === "object" && typeof field.name === "string" && field.name.trim())
      return field.name.trim();
    return null;
  }

  // CricAPI scorecard batting entry (both formats):
  //   Old: { batsman: "Travis Head", r: 11, ct: 2, ... }   ← ct = catches taken in the field
  //   New: { batsman: { id: "...", name: "Travis Head" }, r: 11, ... }
  // "r" here = runs SCORED. ct/c = fielding catches (only present in old format).
  const batsmanName = playerName(node.batsman);
  if (batsmanName && "r" in node) {
    bucket.push(bonusify({
      name: batsmanName,
      runs: numberValue(node.r ?? node.runs),
      wickets: 0,
      catches: numberValue(node.ct ?? node.c ?? 0),
      fifty_bonus: 0, hundred_bonus: 0, three_w_bonus: 0, five_w_bonus: 0,
    }));
    return; // leaf node — don't recurse further
  }

  // CricAPI scorecard bowling entry (both formats):
  //   Old: { bowler: "Krunal Pandya", w: 2, o: "4.0", r: 28 }
  //   New: { bowler: { id: "...", name: "Krunal Pandya" }, w: 2, o: 4, r: 26 }
  // "r" here = runs CONCEDED — must NOT be used as runs scored.
  const bowlerName = playerName(node.bowler);
  if (bowlerName && ("w" in node || "o" in node)) {
    bucket.push(bonusify({
      name: bowlerName,
      runs: 0,
      wickets: numberValue(node.w ?? node.wickets ?? node.bowlWkts),
      catches: 0,
      fifty_bonus: 0, hundred_bonus: 0, three_w_bonus: 0, five_w_bonus: 0,
    }));
    return; // leaf node — don't recurse further
  }

  // Old-format per-entry catching node: { catcher: { id, name }, catch: 1 }
  // (When NOT inside a catching array — handled above — treat as a single-entry aggregate.)
  const catcherName = playerName(node.catcher);
  if (catcherName && "catch" in node) {
    const numCatches = numberValue(node["catch"] ?? 0);
    if (numCatches > 0) {
      bucket.push(bonusify({
        name: catcherName,
        runs: 0, wickets: 0, catches: numCatches,
        fifty_bonus: 0, hundred_bonus: 0, three_w_bonus: 0, five_w_bonus: 0,
      }));
    }
    return;
  }

  // Generic fallback for other provider formats
  const name = safeString(
    node.name ||
      node.fullName ||
      node.playerName ||
      node.batName ||
      node.bowlerName ||
      node.batsmanName ||
      node.nickName
  );

  const hasStatsLikeFields = [
    "runs", "r", "batRuns", "batsmanRuns", "wickets", "w", "bowlWkts", "catches", "c",
  ].some((key) => key in node);

  if (name && hasStatsLikeFields) {
    bucket.push(
      bonusify({
        name,
        runs: numberValue(node.runs ?? node.r ?? node.batRuns ?? node.batsmanRuns),
        wickets: numberValue(node.wickets ?? node.w ?? node.bowlWkts),
        catches: numberValue(node.catches ?? node.c),
        fifty_bonus: 0,
        hundred_bonus: 0,
        three_w_bonus: 0,
        five_w_bonus: 0,
      })
    );
  }

  for (const value of Object.values(node)) {
    collectPlayerRows(value, bucket);
  }
}

/**
 * CricAPI newer match_scorecard format stores catches inside:
 *   scorecard[].wickets = [{ kind:"caught", fielder:[{name:"Philip Salt"}], ... }]
 *
 * This function aggregates catches per fielder into one PlayerStats row each
 * so Math.max merge works correctly alongside batting-row ct values.
 */
function extractCatchesFromWickets(data: MaybeRecord): PlayerStats[] {
  const countByKey = new Map<string, number>();
  const nameByKey  = new Map<string, string>();

  function processWicket(w: any) {
    const kind      = safeString(w.kind ?? w.howOut ?? w.dismissalKind ?? "");
    const dismissal = safeString(w.dismissal ?? w.desc ?? w.dismissalText ?? "");
    // Caught dismissal: kind contains "caught", OR dismissal text starts with "c <name>" (not "c&b")
    const isCaught =
      /caught/i.test(kind) ||
      /^c\s+(?!&\s*b\s)\w/i.test(dismissal);
    if (!isCaught) return;

    const raw = w.fielder ?? w.fielders ?? w.catcher_player;
    const fielders: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const f of fielders) {
      const name =
        typeof f === "string"
          ? f.trim()
          : safeString(f?.name ?? f?.playerName ?? f?.fullName ?? "");
      if (!name) continue;
      const key = name.toLowerCase();
      nameByKey.set(key, nameByKey.get(key) ?? name);
      countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
    }
  }

  // Path 1: scorecard[].wickets
  if (Array.isArray((data as any).scorecard)) {
    for (const inn of (data as any).scorecard) {
      const wkts = inn.wickets ?? inn.fall_wickets ?? inn.fallWickets;
      if (Array.isArray(wkts)) wkts.forEach(processWicket);
    }
  }
  // Path 2: top-level wickets / fall_wickets
  const direct = (data as any).wickets ?? (data as any).fall_wickets ?? (data as any).fallWickets;
  if (Array.isArray(direct)) direct.forEach(processWicket);

  if (countByKey.size === 0) return [];

  return Array.from(countByKey.entries()).map(([key, total]) =>
    bonusify({
      name: nameByKey.get(key) ?? key,
      runs: 0, wickets: 0, catches: total,
      fifty_bonus: 0, hundred_bonus: 0, three_w_bonus: 0, five_w_bonus: 0,
    })
  );
}

function mergePlayers(rows: PlayerStats[]) {
  const byName = new Map<string, PlayerStats>();

  for (const row of rows) {
    const key = row.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, row);
      continue;
    }

    byName.set(key, bonusify({
      ...existing,
      runs: Math.max(existing.runs, row.runs),
      wickets: Math.max(existing.wickets, row.wickets),
      catches: Math.max(existing.catches, row.catches), // each source emits one aggregated row
      fifty_bonus: 0,
      hundred_bonus: 0,
      three_w_bonus: 0,
      five_w_bonus: 0,
    }));
  }

  return Array.from(byName.values());
}

function parseSimpleLiveScore(data: MaybeRecord): PlayerStats[] {
  const rows: PlayerStats[] = [];

  const batsmen = [
    {
      name: safeString(data.batsmanOne),
      runs: numberValue(data.batsmanOneRun),
    },
    {
      name: safeString(data.batsmanTwo),
      runs: numberValue(data.batsmanTwoRun),
    },
  ];

  const bowlers = [
    {
      name: safeString(data.bowlerOne),
      wickets: numberValue(data.bowlerOneWickets),
    },
    {
      name: safeString(data.bowlerTwo),
      wickets: numberValue(data.bowlerTwoWicket),
    },
  ];

  for (const batter of batsmen) {
    if (batter.name) {
      rows.push(bonusify({
        name: batter.name,
        runs: batter.runs,
        wickets: 0,
        catches: 0,
        fifty_bonus: 0,
        hundred_bonus: 0,
        three_w_bonus: 0,
        five_w_bonus: 0,
      }));
    }
  }

  for (const bowler of bowlers) {
    if (bowler.name) {
      rows.push(bonusify({
        name: bowler.name,
        runs: 0,
        wickets: bowler.wickets,
        catches: 0,
        fifty_bonus: 0,
        hundred_bonus: 0,
        three_w_bonus: 0,
        five_w_bonus: 0,
      }));
    }
  }

  return rows;
}

function uniqueRosterNames(squads: SquadTeam[]): string[] {
  const s = new Set<string>();
  for (const t of squads) {
    for (const p of t.players) {
      const n = p.trim();
      if (n) s.add(n);
    }
  }
  return [...s].sort((a, b) => a.localeCompare(b));
}

function extractSquadsFromPayload(root: MaybeRecord | null | undefined): SquadTeam[] {
  if (!root || typeof root !== "object") return [];
  const data = (root as MaybeRecord).data ?? root;
  if (!data || typeof data !== "object") return [];

  // CricAPI match_squad returns data as a direct array of team objects
  if (Array.isArray(data)) {
    const out: SquadTeam[] = [];
    for (const t of data) {
      const teamName = safeString((t as any).name || (t as any).teamName);
      const pl = (t as any).players;
      if (!Array.isArray(pl)) continue;
      const names = pl
        .map((p: any) => safeString(typeof p === "string" ? p : p.name || p.playerName || p.fullName || p.batsman))
        .filter(Boolean);
      if (names.length) out.push({ teamName: teamName || "Team", players: names });
    }
    if (out.length) return out;
  }

  const teamArr = (data as MaybeRecord).team;
  if (Array.isArray(teamArr)) {
    const out: SquadTeam[] = [];
    for (const t of teamArr) {
      const teamName = safeString((t as any).name || (t as any).teamName);
      const pl = (t as any).players;
      if (!Array.isArray(pl)) continue;
      const names = pl
        .map((p: any) => safeString(typeof p === "string" ? p : p.name || p.playerName || p.batsman || p.fullName))
        .filter(Boolean);
      if (names.length) out.push({ teamName: teamName || "Team", players: names });
    }
    if (out.length) return out;
  }

  const teams = (data as MaybeRecord).teams;
  if (Array.isArray(teams) && teams[0] && typeof teams[0] === "object" && Array.isArray((teams[0] as any).players)) {
    const out: SquadTeam[] = [];
    for (const t of teams) {
      const teamName = safeString((t as any).name || (t as any).teamName);
      const pl = (t as any).players;
      if (!Array.isArray(pl)) continue;
      const names = pl.map((p: any) => safeString(typeof p === "string" ? p : p.name)).filter(Boolean);
      if (names.length) out.push({ teamName: teamName || "Team", players: names });
    }
    if (out.length) return out;
  }

  const sq = (data as MaybeRecord).squad;
  if (Array.isArray(sq)) {
    const out: SquadTeam[] = [];
    for (const block of sq) {
      const teamName = safeString((block as any).name || (block as any).teamName || (block as any).team);
      const players = (block as any).players;
      if (!Array.isArray(players)) continue;
      const names = players.map((p: any) => safeString(typeof p === "string" ? p : p.name)).filter(Boolean);
      if (names.length) out.push({ teamName: teamName || "Squad", players: names });
    }
    if (out.length) return out;
  }

  // CricAPI match_scorecard new format: data.scorecard = [{ inning, batting:[{batsman:{name}},...], bowling:[{bowler:{name}},...] }]
  const scorecard = (data as MaybeRecord).scorecard;
  if (Array.isArray(scorecard) && scorecard.length > 0) {
    const byTeam = new Map<string, Set<string>>();
    for (const inn of scorecard) {
      // "Sunrisers Hyderabad Inning 1" → "Sunrisers Hyderabad"
      const inningLabel = safeString((inn as any).inning || (inn as any).inningsName || "");
      const teamName = inningLabel.replace(/\s+(inning|innings)\s*\d+\s*$/i, "").trim() || inningLabel;
      if (!byTeam.has(teamName)) byTeam.set(teamName, new Set<string>());
      const teamSet = byTeam.get(teamName)!;
      for (const b of ((inn as any).batting ?? [])) {
        const n = typeof b.batsman === "object" ? safeString(b.batsman?.name) : safeString(b.batsman);
        if (n) teamSet.add(n);
      }
      for (const b of ((inn as any).bowling ?? [])) {
        const n = typeof b.bowler === "object" ? safeString(b.bowler?.name) : safeString(b.bowler);
        if (n) teamSet.add(n);
      }
    }
    const out: SquadTeam[] = [];
    for (const [teamName, names] of byTeam) {
      if (names.size) out.push({ teamName, players: [...names] });
    }
    if (out.length) return out;
  }

  // CricAPI match_scorecard: data.players = { "Team Name": [{id, name, role,...}] }
  const playersByTeam = (data as MaybeRecord).players;
  if (playersByTeam && typeof playersByTeam === "object" && !Array.isArray(playersByTeam)) {
    const out: SquadTeam[] = [];
    for (const [teamName, players] of Object.entries(playersByTeam)) {
      if (!Array.isArray(players)) continue;
      const names = (players as any[])
        .map((p: any) => safeString(typeof p === "string" ? p : p.name || p.playerName || p.fullName))
        .filter(Boolean);
      if (names.length) out.push({ teamName: teamName || "Team", players: names });
    }
    if (out.length) return out;
  }

  // CricAPI match_info: data.teamInfo = [{name, img, players:[{id,name,...}]}]
  const teamInfo = (data as MaybeRecord).teamInfo;
  if (Array.isArray(teamInfo)) {
    const out: SquadTeam[] = [];
    for (const t of teamInfo) {
      const teamName = safeString((t as any).name || (t as any).teamName);
      const pl = (t as any).players;
      if (!Array.isArray(pl)) continue;
      const names = (pl as any[])
        .map((p: any) => safeString(typeof p === "string" ? p : p.name || p.playerName || p.fullName))
        .filter(Boolean);
      if (names.length) out.push({ teamName: teamName || "Team", players: names });
    }
    if (out.length) return out;
  }

  return [];
}

function extractSquadsFromBatting(data: MaybeRecord): SquadTeam[] {
  const batting = data.batting;
  if (!Array.isArray(batting)) return [];
  const out: SquadTeam[] = [];
  for (const inn of batting) {
    const title = safeString((inn as any).title || (inn as any).inningsTitle || "Batting");
    const set = new Set<string>();

    // Format A: scores array of rows/cells
    const scores = (inn as any).scores;
    if (Array.isArray(scores)) {
      for (const row of scores) {
        const cells = Array.isArray(row) ? row : [row];
        for (const cell of cells) {
          const b = safeString((cell as any)?.batsman || (cell as any)?.name);
          if (b && b.toLowerCase() !== "extras") set.add(b);
        }
      }
    }

    // Format B: CricAPI match_scorecard — batting[].batsman = [{batsman, r, b, ...}]
    const batsmen = (inn as any).batsman ?? (inn as any).batsmen;
    if (Array.isArray(batsmen)) {
      for (const b of batsmen) {
        const name = safeString((b as any).batsman || (b as any).name || (b as any).fullName);
        if (name && name.toLowerCase() !== "extras") set.add(name);
      }
    }

    // Format C: bowler array in same innings object (gets the bowling team players too)
    const bowlers = (inn as any).bowler ?? (inn as any).bowlers;
    if (Array.isArray(bowlers)) {
      for (const b of bowlers) {
        const name = safeString((b as any).bowler || (b as any).name || (b as any).fullName);
        if (name && name.toLowerCase() !== "extras") set.add(name);
      }
    }

    if (set.size) out.push({ teamName: title, players: [...set] });
  }
  return out;
}

function squadPlayerCount(squads: SquadTeam[]) {
  return squads.reduce((n, t) => n + t.players.length, 0);
}

async function tryFetchSquadsFromSquadApi(externalMatchId: string): Promise<SquadTeam[]> {
  if (!isCricapiBase(envBaseUrl())) return [];
  const paths = [
    `/v1/match_squad?id=${encodeURIComponent(externalMatchId)}`,
    `/v1/squads?id=${encodeURIComponent(externalMatchId)}`,
  ];
  for (const path of paths) {
    try {
      const payload = await fetchJson(path);
      const squads = extractSquadsFromPayload(payload);
      if (squadPlayerCount(squads) >= 8) return squads;
    } catch {
      // try next path
    }
  }
  return [];
}

/**
 * Pull the best available roster for any match phase:
 *
 * - Completed / in-progress → scorecard first (gives actual Playing XI, ~22 names)
 * - Pre-match             → squad API (gives full squad before toss, ~30 names)
 *
 * We always prefer the scorecard result when it has ≥ 11 players per side
 * because it reflects who actually took the field, not just the squad selection.
 */
export async function fetchMatchRoster(externalMatchId: string): Promise<{ squads: SquadTeam[]; rosterNames: string[] }> {
  const id = encodeURIComponent(externalMatchId);
  const candidates: SquadTeam[][] = [];

  const absorb = (squads: SquadTeam[]) => {
    if (squadPlayerCount(squads) > 0) candidates.push(squads);
  };

  // 1. Scorecard — actual Playing XI for live/completed matches
  try {
    const full = await refreshMatchFromProvider(externalMatchId);
    absorb(full.squads);
    // If we got a full playing XI (≥ 11 players per team combined), prefer it
    if (squadPlayerCount(full.squads) >= 11) {
      return { squads: full.squads, rosterNames: full.rosterNames };
    }
  } catch { /* scorecard not yet published */ }

  // 2. match_info — works for any match state; has data.players (dict) or data.teamInfo
  if (isCricapiBase(envBaseUrl())) {
    try {
      const payload = await fetchJson(`/v1/match_info?id=${id}`);
      if (payload?.status !== "failure") {
        absorb(extractSquadsFromPayload(payload));
      }
    } catch { /* ignore */ }
  }

  // 3. Squad API — announced squad (pre-match and shortly before)
  try {
    absorb(await tryFetchSquadsFromSquadApi(externalMatchId));
  } catch { /* ignore */ }

  // Return the richest result we found
  if (candidates.length === 0) {
    return { squads: [], rosterNames: [] };
  }
  const best = candidates.sort((a, b) => squadPlayerCount(b) - squadPlayerCount(a))[0];
  return { squads: best, rosterNames: uniqueRosterNames(best) };
}

export async function refreshMatchFromProvider(externalMatchId: string): Promise<ProviderRefresh> {
  const id = externalMatchId;
  const candidatePaths = isCricapiBase(envBaseUrl())
    ? [
        `/v1/match_scorecard?offset=0&id=${id}`,
        `/v1/match_scorecard?id=${id}`,          // without offset
        `/v1/match_points?offset=0&id=${id}`,
        `/v1/match_points?id=${id}`,
        `/v1/match_info?id=${id}`,               // last resort — has metadata but fewer stats
      ]
    : [
        `/v1/score/${id}`,
        `/v1/scorecard/${id}`,
        `/matches/get-scorecard?matchId=${id}`,
        `/matches/get-scorecard-v2?matchId=${id}`,
        `/v1/matches/${id}/scorecard`,
      ];

  let payload: MaybeRecord | null = null;
  let scorecardFailed = false;
  let lastFailReason = "";

  for (const path of candidatePaths) {
    try {
      const p = await fetchJson(path);
      // Skip explicit API failures — quota errors are handled inside fetchJson.
      if (p?.status === "failure") {
        scorecardFailed = true;
        const r = safeString(p.reason || p.message || p.error || "");
        if (r) lastFailReason = r;
        continue;
      }
      if (p) { payload = p; break; }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg) lastFailReason = msg;
    }
  }

  // When no scorecard is available, return empty stats rather than throwing so
  // the match metadata (status, venue, etc.) still gets updated on sync.
  if (!payload) {
    // Classify the failure so the UI can give actionable advice
    const isRateLimit = /block|rate.?limit|15.?min/i.test(lastFailReason);
    const isPlanError = /plan|subscri|paid|unauthori|forbidden|access|403/i.test(lastFailReason) ||
                        (scorecardFailed && !isRateLimit && !lastFailReason);
    const liveMsg = isRateLimit
      ? `API rate-limited (${lastFailReason}). Wait 15 minutes and try again.`
      : isPlanError
      ? `Scorecard endpoint requires a paid CricAPI plan. Use ✏️ Edit to enter stats manually.`
      : lastFailReason
      ? `Scorecard not available: ${lastFailReason}. Use ✏️ Edit to enter stats manually.`
      : "Scorecard not available from the API for this match. Use ✏️ Edit to enter stats manually.";

    return {
      status: scorecardFailed ? "COMPLETED" : "LIVE",
      live_summary: liveMsg,
      fixture: undefined,
      venue: null,
      toss_winner: null,
      source_url: null,
      players: [],
      squads: [],
      rosterNames: [],
      raw: null,
    };
  }

  const data = payload.data || payload;
  const rows: PlayerStats[] = [];
  collectPlayerRows(data, rows);
  // New-format catches live in scorecard[].wickets[].fielder — add them before merge
  rows.push(...extractCatchesFromWickets(data as MaybeRecord));
  const merged = mergePlayers(rows);
  const simpleFallback = merged.length > 0 ? merged : parseSimpleLiveScore(data);

  const dataRec = data as MaybeRecord;
  let squads = extractSquadsFromPayload(payload);
  let count = squadPlayerCount(squads);
  if (count < 8) {
    const fromBatting = extractSquadsFromBatting(dataRec);
    if (squadPlayerCount(fromBatting) > count) {
      squads = fromBatting;
      count = squadPlayerCount(squads);
    }
  }
  if (count < 8 && isCricapiBase(envBaseUrl())) {
    const extra = await tryFetchSquadsFromSquadApi(externalMatchId);
    if (squadPlayerCount(extra) > count) squads = extra;
  }

  let rosterNames = uniqueRosterNames(squads);
  if (rosterNames.length === 0 && simpleFallback.length) {
    rosterNames = [...new Set(simpleFallback.map((p) => p.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    squads = rosterNames.length ? [{ teamName: "From live scorecard", players: rosterNames }] : [];
  }

  return {
    status: parseStatus(safeString(data.update || data.status || payload.status || "LIVE")),
    live_summary: safeString(data.update || data.status || payload.message || "") || null,
    fixture: safeString(data.title || data.fixture || data.name || "") || undefined,
    venue: safeString(data.venue || data.ground || "") || null,
    toss_winner: safeString(data.toss_winner || data.tossWinner || "") || null,
    source_url: safeString(data.url || data.source_url || "") || null,
    players: simpleFallback,
    squads,
    rosterNames,
    raw: payload,
  };
}
