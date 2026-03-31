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

type KeyBlockType = "rate_limit" | "quota";

/**
 * Classify the CricAPI failure reason into a block type:
 * - "rate_limit" = "Blocked for 15 minutes" → skip for 16 min
 * - "quota"      = "hits today exceeded hits limit" → skip for rest of day
 */
function classifyBlock(reason: string): KeyBlockType | null {
  const r = reason.toLowerCase();
  if (r.includes("15 minutes") || r.includes("blocked for")) return "rate_limit";
  if (r.includes("exceeded") || r.includes("hits today") || r.includes("hits limit") || r.includes("blocking since"))
    return "quota";
  if (r.includes("block") || r.includes("limit") || r.includes("credit")) return "rate_limit"; // safe default
  return null;
}

/** Record a block on a key — fire-and-forget. */
function recordKeyBlock(key: string, type: KeyBlockType) {
  const alias = keyAlias(key);
  const db = getAdminClient();
  if (!db) return;
  if (type === "rate_limit") {
    // Block for 16 minutes (1 extra minute buffer)
    const until = new Date(Date.now() + 16 * 60 * 1000).toISOString();
    db.rpc("mark_key_rate_limited", { p_alias: alias, p_until: until }).catch(() => {});
  } else {
    // Daily quota — block until next calendar day
    const today = new Date().toISOString().slice(0, 10);
    db.rpc("mark_key_quota_exhausted", { p_alias: alias, p_date: today }).catch(() => {});
  }
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
  /** CricAPI player UUID — used for reliable ID-based sync matching */
  id?: string;
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
  /** lowercase player name → CricAPI player UUID */
  playerIdMap?: Record<string, string>;
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
  /** Flat name→id map across all squads for lineup-save ID capture */
  nameToId: Record<string, string>;
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
    cleanEnvText(process.env.CRICKET_API_KEY_4),
    cleanEnvText(process.env.CRICKET_API_KEY_5),
    cleanEnvText(process.env.CRICKET_API_KEY_6),
    cleanEnvText(process.env.CRICKET_API_KEY_7),
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

type KeyStatus = {
  hits: number;
  rateLimitedUntil: Date | null;
  quotaExhaustedAt: string | null; // ISO date string
};

/**
 * Tries each API key ordered by today's hit count (least-used first).
 * Skips keys that are currently rate-limited (15-min block) or have exceeded
 * their daily quota. Records blocks in Supabase so future calls also skip them.
 * Throws only when all usable keys are exhausted.
 */
async function fetchJson(path: string) {
  const baseUrl = envBaseUrl();
  const keys = allApiKeys();
  const today = new Date().toISOString().slice(0, 10);
  const nowMs = Date.now();

  // Load hit counts + block state for all keys in one query
  const keyStatusMap = await (async (): Promise<Record<string, KeyStatus>> => {
    try {
      const db = getAdminClient();
      if (!db) return {};
      const { data } = await db
        .from("api_key_stats")
        .select("key_alias, hits, rate_limited_until, quota_exhausted_at")
        .eq("stat_date", today);
      const map: Record<string, KeyStatus> = {};
      for (const row of data ?? []) {
        map[row.key_alias as string] = {
          hits: (row.hits as number) ?? 0,
          rateLimitedUntil: row.rate_limited_until ? new Date(row.rate_limited_until as string) : null,
          quotaExhaustedAt: (row.quota_exhausted_at as string) ?? null,
        };
      }
      return map;
    } catch { return {}; }
  })();

  const statusFor = (k: string): KeyStatus =>
    keyStatusMap[keyAlias(k)] ?? { hits: 0, rateLimitedUntil: null, quotaExhaustedAt: null };

  const isBlocked = (k: string): boolean => {
    const s = statusFor(k);
    if (s.quotaExhaustedAt === today) return true;  // daily quota gone
    if (s.rateLimitedUntil && s.rateLimitedUntil.getTime() > nowMs) return true; // still in 15-min window
    return false;
  };

  // Order by ascending hit count; skip blocked keys (push them to end so they can still be
  // tried as a last resort if every key is somehow blocked)
  const ordered = [...keys].sort((a, b) => {
    const ba = isBlocked(a) ? 1 : 0;
    const bb = isBlocked(b) ? 1 : 0;
    if (ba !== bb) return ba - bb; // unblocked first
    const da = statusFor(a).hits;
    const db2 = statusFor(b).hits;
    return da !== db2 ? da - db2 : Math.random() - 0.5;
  });
  if (ordered.length === 0) ordered.push("");

  let lastError = "";
  let skippedDueToBlock = 0;

  for (const key of ordered) {
    // Hard-skip keys we know are blocked (don't even make the HTTP call)
    if (key && isBlocked(key)) {
      const s = statusFor(key);
      if (s.quotaExhaustedAt === today) {
        lastError = `Key ${keyAlias(key)} quota exhausted for today`;
      } else if (s.rateLimitedUntil) {
        const resumeIn = Math.ceil((s.rateLimitedUntil.getTime() - nowMs) / 60000);
        lastError = `Key ${keyAlias(key)} rate-limited for ~${resumeIn} more min`;
      }
      skippedDueToBlock++;
      continue;
    }

    const requestPath = isCricapiBase(baseUrl) ? injectKey(path, key) : path;
    const headers = buildHeaders(key);
    const response = await fetch(`${baseUrl}${requestPath}`, { headers, cache: "no-store" });
    if (!response.ok) {
      lastError = `HTTP ${response.status}`;
      continue;
    }
    const payload = await response.json();

    // Always count the hit regardless of outcome
    trackKeyHit(key);

    if (isQuotaError(payload)) {
      const reason = String(payload.reason || payload.message || "");
      lastError = reason || "quota/rate-limit exceeded";
      const blockType = classifyBlock(reason);
      if (blockType) recordKeyBlock(key, blockType);
      continue; // try next key
    }
    return payload;
  }

  const blockedMsg = skippedDueToBlock > 0 ? ` (${skippedDueToBlock} key(s) skipped — blocked)` : "";
  throw new Error(`Cricket API error: ${lastError || "all keys failed"}${blockedMsg}`);
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
  function playerId(field: any): string | undefined {
    if (field && typeof field === "object" && typeof field.id === "string" && field.id.trim())
      return field.id.trim();
    return undefined;
  }

  // CricAPI scorecard batting entry (both formats):
  //   Old: { batsman: "Travis Head", r: 11, ct: 2, ... }   ← ct = catches taken in the field
  //   New: { batsman: { id: "...", name: "Travis Head" }, r: 11, ... }
  // "r" here = runs SCORED. ct/c = fielding catches (only present in old format).
  const batsmanName = playerName(node.batsman);
  if (batsmanName && "r" in node) {
    bucket.push(bonusify({
      id: playerId(node.batsman),
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
      id: playerId(node.bowler),
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

/**
 * Most reliable source for catches: parse the catcher from each batting
 * entry's dismissal-text / catcher field.
 *
 * CricAPI sometimes omits the "catcher" field on the catching[] row for
 * certain fielders (e.g. Phil Salt's 3 catches in RCB vs SRH Match 1 had
 * no name on the catching[] entry). The dismissal-text "c NAME b BOWLER"
 * always carries the correct name.
 *
 * Formats handled:
 *   dismissal-text "c Phil Salt b Jacob Duffy"  → catcher = Phil Salt
 *   dismissal-text "c&b Jacob Duffy"            → caught-and-bowled, catcher = Jacob Duffy
 *   catcher field present                        → use that directly
 */
function extractCatchesFromBattingDismissals(data: MaybeRecord): PlayerStats[] {
  const countByKey = new Map<string, number>();
  const nameByKey  = new Map<string, string>();
  const idByKey    = new Map<string, string>(); // preserve catcher's player ID

  function addCatch(name: string, id?: string) {
    const key = name.toLowerCase().trim();
    if (!key) return;
    nameByKey.set(key, nameByKey.get(key) ?? name.trim());
    if (id && !idByKey.has(key)) idByKey.set(key, id);
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
  }

  function processBattingEntry(b: any) {
    const dismissal = safeString(b.dismissal ?? b.howOut ?? "").toLowerCase();
    if (!dismissal.includes("catch") && dismissal !== "caught") {
      const dt = safeString(b["dismissal-text"] ?? b.dismissalText ?? "");
      if (!/^c[\s&]/i.test(dt)) return;
    }

    // Priority 1: explicit catcher field (also carries the player UUID)
    const catcherField = b.catcher;
    if (catcherField) {
      const name =
        typeof catcherField === "string"
          ? catcherField
          : safeString(catcherField?.name ?? catcherField?.playerName ?? "");
      const id =
        catcherField && typeof catcherField === "object" && typeof catcherField.id === "string"
          ? catcherField.id.trim() || undefined
          : undefined;
      if (name) { addCatch(name, id); return; }
    }

    // Priority 2: parse from dismissal-text ("c Phil Salt b Jacob Duffy")
    const dt = safeString(b["dismissal-text"] ?? b.dismissalText ?? "");
    if (!dt) return;

    const cnb = dt.match(/^c\s*&\s*b\s+(.+)/i);
    if (cnb) {
      // caught-and-bowled: catcher = bowler (use bowler field's id if available)
      const bowlerField = b.bowler;
      const id = bowlerField && typeof bowlerField === "object" ? safeString(bowlerField.id) || undefined : undefined;
      addCatch(cnb[1].trim(), id); return;
    }

    const caught = dt.match(/^c\s+(.+?)\s+b\s+/i);
    if (caught) { addCatch(caught[1].trim()); return; }
  }

  if (Array.isArray((data as any).scorecard)) {
    for (const inn of (data as any).scorecard) {
      if (Array.isArray(inn.batting)) inn.batting.forEach(processBattingEntry);
    }
  }
  if (Array.isArray((data as any).batting)) {
    (data as any).batting.forEach(processBattingEntry);
  }

  if (countByKey.size === 0) return [];

  return Array.from(countByKey.entries()).map(([key, total]) =>
    bonusify({
      id: idByKey.get(key),
      name: nameByKey.get(key) ?? key,
      runs: 0, wickets: 0, catches: total,
      fifty_bonus: 0, hundred_bonus: 0, three_w_bonus: 0, five_w_bonus: 0,
    })
  );
}

/**
 * Build name-matching variants the same way refresh/route.ts does, so
 * catch rows with a slightly different name form (e.g. "Phil Salt" vs
 * "Philip Salt") still get applied to the right player.
 */
function nameVariants(name: string): string[] {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const variants = new Set<string>();
  variants.add(normalized);
  variants.add(normalized.replace(/\s+/g, ""));
  if (tokens.length >= 2) {
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    variants.add(`${first} ${last}`);
    variants.add(`${first[0]} ${last}`);
    variants.add(`${first[0]}${last}`);
    variants.add(last);
  }
  return Array.from(variants).filter(Boolean);
}

/**
 * After mergePlayers, apply catches from dismissal-text-derived rows to
 * the existing merged array using variant-based matching.  This handles
 * cases where the dismissal-text has a different name spelling than the
 * batting row (e.g. "Phil Salt" in dismissal-text vs "Philip Salt" from
 * batting entry).
 */
function patchCatches(merged: PlayerStats[], catchRows: PlayerStats[]): PlayerStats[] {
  // Build lookup maps over the merged array
  const idToIdx      = new Map<string, number>();
  const variantToIdx = new Map<string, number>();
  merged.forEach((p, i) => {
    if (p.id) idToIdx.set(p.id, i);
    for (const v of nameVariants(p.name)) {
      if (!variantToIdx.has(v)) variantToIdx.set(v, i);
    }
  });

  const result = merged.map(p => ({ ...p }));

  for (const cr of catchRows) {
    if (cr.catches <= 0) continue;
    let idx: number | undefined;

    // ID match is authoritative — no name ambiguity
    if (cr.id) idx = idToIdx.get(cr.id);

    // Fall back to variant-based name match
    if (idx === undefined) {
      for (const v of nameVariants(cr.name)) {
        idx = variantToIdx.get(v);
        if (idx !== undefined) break;
      }
    }

    if (idx !== undefined) {
      result[idx] = bonusify({
        ...result[idx],
        catches: Math.max(result[idx].catches, cr.catches),
        // Capture the ID if the existing row didn't have one
        id: result[idx].id ?? cr.id,
      });
    } else {
      // Fielder not in batting/bowling (rare — pure fielder with no other involvement)
      result.push(bonusify({ ...cr }));
    }
  }

  return result;
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

/** Merge all playerIdMap entries across squads into one flat map */
function buildNameToId(squads: SquadTeam[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const t of squads) {
    if (t.playerIdMap) Object.assign(m, t.playerIdMap);
  }
  return m;
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

/** Extract player IDs from an array of player objects into a lowercase-name→id map */
function extractIdMap(pl: any[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const p of pl) {
    if (typeof p !== "object" || !p) continue;
    const name = safeString(p.name || p.playerName || p.fullName || "");
    const id   = safeString(p.id || p.playerId || "");
    if (name && id) m[name.toLowerCase()] = id;
  }
  return m;
}

function withIdMap(teamName: string, names: string[], idMap: Record<string, string>): SquadTeam {
  const playerIdMap = Object.keys(idMap).length ? idMap : undefined;
  return { teamName, players: names, playerIdMap };
}

/** Batting side name from an innings block (scorecard or batting[] shape). */
function parseInningBattingSideName(inn: unknown): string {
  const o = inn as MaybeRecord;
  const inningLabel = safeString(o?.inning || o?.inningsName || o?.title || o?.inningsTitle || "");
  const stripped = inningLabel.replace(/\s+(inning|innings)\s*\d+\s*$/i, "").trim();
  return stripped || inningLabel;
}

function teamsLooselySame(a: string, b: string): boolean {
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  if (!la || !lb) return false;
  if (la === lb) return true;
  if (la.includes(lb) || lb.includes(la)) return true;
  return false;
}

/** Team names from match payload (string or object entries). */
function teamNamesFromMatchData(data: MaybeRecord): string[] {
  const teams = data.teams;
  if (!Array.isArray(teams)) return [];
  const names: string[] = [];
  for (const t of teams) {
    const n =
      typeof t === "string"
        ? safeString(t)
        : safeString((t as MaybeRecord)?.name || (t as MaybeRecord)?.teamName || (t as MaybeRecord)?.team || (t as MaybeRecord)?.teamSName);
    if (n) names.push(n);
  }
  return [...new Set(names)];
}

/**
 * Bowlers listed under an innings belong to the fielding side, not the batting side named in the label.
 */
function resolveFieldingTeamName(battingTeam: string, inningsBattingSides: string[], data: MaybeRecord): string | null {
  if (!battingTeam) return null;
  const ordered = [...new Set(inningsBattingSides.filter(Boolean))];
  if (ordered.length >= 2) {
    const other = ordered.find((t) => !teamsLooselySame(t, battingTeam));
    if (other) return other;
  }
  const fromApi = teamNamesFromMatchData(data);
  if (fromApi.length === 2) {
    const other = fromApi.find((n) => !teamsLooselySame(n, battingTeam));
    if (other) return other;
  }
  if (ordered.length === 1 && fromApi.length === 2) {
    const sole = ordered[0]!;
    const other = fromApi.find((n) => !teamsLooselySame(n, sole));
    if (other) return other;
  }
  return null;
}

function scorecardInningsHasBatting(inn: unknown): boolean {
  const b = (inn as MaybeRecord)?.batting;
  return Array.isArray(b) && b.length > 0;
}

/** True once at least one innings has a batting card (toss done / match underway). */
function scorecardMatchHasBegun(scorecard: unknown[]): boolean {
  if (!Array.isArray(scorecard)) return false;
  return scorecard.some(scorecardInningsHasBatting);
}

function rowLooksLikeSubstituteOrImpact(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const r = row as MaybeRecord;
  if (r.substitute === true || r.isSubstitute === true || r.impactSubstitute === true || r.impactPlayer === true || r.isImpactPlayer === true)
    return true;
  const pr = safeString(r.playingRole as string).toLowerCase();
  if (pr.includes("substitute") || pr.includes("impact")) return true;
  const b = (r as any).batsman;
  const nm = typeof b === "object" && b ? safeString((b as MaybeRecord).name) : safeString(b);
  if (/\(impact/i.test(nm) || /\bsub(stitute)?\b/i.test(nm)) return true;
  return false;
}

function battingNamesOrderedExcludingSubs(inn: unknown): string[] {
  const names: string[] = [];
  for (const row of (((inn as MaybeRecord)?.batting as unknown[]) ?? [])) {
    if (rowLooksLikeSubstituteOrImpact(row)) continue;
    const b = (row as any).batsman;
    const n = typeof b === "object" && b ? safeString((b as MaybeRecord).name) : safeString(b);
    if (!n || n.toLowerCase() === "extras") continue;
    names.push(n);
  }
  return names;
}

function bowlingNamesOrdered(inn: unknown): string[] {
  const names: string[] = [];
  for (const row of (((inn as MaybeRecord)?.bowling as unknown[]) ?? [])) {
    const b = (row as any).bowler;
    const n = typeof b === "object" && b ? safeString((b as MaybeRecord).name) : safeString(b);
    if (!n || n.toLowerCase() === "extras") continue;
    names.push(n);
  }
  return names;
}

function findBattingInningForTeam(scorecard: any[], team: string): any | null {
  for (const inn of scorecard) {
    if (teamsLooselySame(parseInningBattingSideName(inn), team)) return inn;
  }
  return null;
}

function findFieldingInningForTeam(scorecard: any[], fieldingTeam: string, data: MaybeRecord): any | null {
  const sides = scorecard.map((i) => parseInningBattingSideName(i)).filter(Boolean);
  for (const inn of scorecard) {
    const bt = parseInningBattingSideName(inn);
    if (!bt) continue;
    const fld = resolveFieldingTeamName(bt, sides, data);
    if (fld && teamsLooselySame(fld, fieldingTeam)) return inn;
  }
  return null;
}

function fillPlayerIdsFromScorecard(names: string[], scorecard: any[]): Record<string, string> {
  const need = new Set(names.map((n) => n.toLowerCase()));
  const idMap: Record<string, string> = {};
  for (const inn of scorecard) {
    for (const row of ((inn as MaybeRecord)?.batting as unknown[]) ?? []) {
      const b = (row as any).batsman;
      const n = typeof b === "object" && b ? safeString((b as MaybeRecord).name) : safeString(b);
      const id = typeof b === "object" && b ? safeString((b as MaybeRecord).id || "") : "";
      const k = n.toLowerCase();
      if (n && id && need.has(k) && !idMap[k]) idMap[k] = id;
    }
    for (const row of ((inn as MaybeRecord)?.bowling as unknown[]) ?? []) {
      const b = (row as any).bowler;
      const n = typeof b === "object" && b ? safeString((b as MaybeRecord).name) : safeString(b);
      const id = typeof b === "object" && b ? safeString((b as MaybeRecord).id || "") : "";
      const k = n.toLowerCase();
      if (n && id && need.has(k) && !idMap[k]) idMap[k] = id;
    }
  }
  return idMap;
}

/**
 * Announced / starting XI for fantasy: each team's own batting card (order, max 11),
 * excluding obvious impact/super-sub rows, then fill toward 11 with bowlers from the
 * innings where that team fielded (covers non-batters who never get a batting row).
 */
function extractPlayingElevenSquadsFromScorecard(data: MaybeRecord, scorecard: any[]): SquadTeam[] {
  const sides = [...new Set(scorecard.map((i) => parseInningBattingSideName(i)).filter(Boolean))];
  if (sides.length < 2) return [];

  const playingXIForTeam = (team: string): string[] => {
    const batInn = findBattingInningForTeam(scorecard, team);
    let names = batInn ? battingNamesOrderedExcludingSubs(batInn) : [];
    if (names.length > 11) names = names.slice(0, 11);

    if (names.length < 11) {
      const fldInn = findFieldingInningForTeam(scorecard, team, data);
      const bowl = fldInn ? bowlingNamesOrdered(fldInn) : [];
      const seen = new Set(names.map((n) => n.toLowerCase()));
      for (const b of bowl) {
        if (names.length >= 11) break;
        const k = b.toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          names.push(b);
        }
      }
    }
    return names;
  };

  const fixtureOrder = teamNamesFromMatchData(data);
  const out: SquadTeam[] = [];
  const used = new Set<string>();

  if (fixtureOrder.length === 2) {
    for (const hint of fixtureOrder) {
      const tSide = sides.find((s) => teamsLooselySame(s, hint));
      if (!tSide || used.has(tSide)) continue;
      used.add(tSide);
      const names = playingXIForTeam(tSide);
      if (names.length) out.push(withIdMap(tSide, names, fillPlayerIdsFromScorecard(names, scorecard)));
    }
  }
  for (const tSide of sides) {
    if (used.has(tSide)) continue;
    const names = playingXIForTeam(tSide);
    if (names.length) out.push(withIdMap(tSide, names, fillPlayerIdsFromScorecard(names, scorecard)));
  }
  return out;
}

/** Legacy: union of batters + bowlers per innings (includes super-subs who later appear). */
function extractMergedSquadsFromScorecard(data: MaybeRecord, scorecard: any[]): SquadTeam[] {
  const dataRec = data;
  const inningsSides = scorecard.map((inn) => parseInningBattingSideName(inn)).filter(Boolean);
  const byTeam = new Map<string, Set<string>>();
  const byTeamIds = new Map<string, Record<string, string>>();
  const ensure = (name: string) => {
    if (!byTeam.has(name)) {
      byTeam.set(name, new Set<string>());
      byTeamIds.set(name, {});
    }
  };
  for (const inn of scorecard) {
    const battingTeam = parseInningBattingSideName(inn);
    if (!battingTeam) continue;
    const bowlingTeam = resolveFieldingTeamName(battingTeam, inningsSides, dataRec);
    ensure(battingTeam);
    const batSet = byTeam.get(battingTeam)!;
    const batIds = byTeamIds.get(battingTeam)!;
    for (const b of ((inn as any).batting ?? [])) {
      const n = typeof b.batsman === "object" ? safeString(b.batsman?.name) : safeString(b.batsman);
      const id = typeof b.batsman === "object" ? safeString(b.batsman?.id || "") : "";
      if (n && n.toLowerCase() !== "extras") {
        batSet.add(n);
        if (id) batIds[n.toLowerCase()] = id;
      }
    }
    if (bowlingTeam) {
      ensure(bowlingTeam);
      const bowlSet = byTeam.get(bowlingTeam)!;
      const bowlIds = byTeamIds.get(bowlingTeam)!;
      for (const b of ((inn as any).bowling ?? [])) {
        const n = typeof b.bowler === "object" ? safeString(b.bowler?.name) : safeString(b.bowler);
        const id = typeof b.bowler === "object" ? safeString(b.bowler?.id || "") : "";
        if (n && n.toLowerCase() !== "extras") {
          bowlSet.add(n);
          if (id) bowlIds[n.toLowerCase()] = id;
        }
      }
    }
  }
  const order = [...new Set(inningsSides)];
  const out: SquadTeam[] = [];
  for (const [teamName, names] of byTeam) {
    if (names.size) out.push(withIdMap(teamName, [...names], byTeamIds.get(teamName) ?? {}));
  }
  out.sort((a, b) => {
    const ia = order.indexOf(a.teamName);
    const ib = order.indexOf(b.teamName);
    const sa = ia === -1 ? 999 : ia;
    const sb = ib === -1 ? 999 : ib;
    return sa - sb;
  });
  return out;
}

function providerPayloadSaysMatchNotStarted(data: MaybeRecord): boolean {
  if (data.matchStarted === false) return true;
  if (data.matchEnded === true) return false;
  const st = safeString(data.status || data.state || data.matchState || "").toLowerCase();
  if (st.includes("not started") || st.includes("scheduled") || st.includes("upcoming") || st.includes("fixture")) return true;
  if (st.includes("live") || st.includes("innings") || st.includes("complete") || st.includes("won")) return false;
  return false;
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
      if (names.length) out.push(withIdMap(teamName || "Team", names, extractIdMap(pl)));
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
      if (names.length) out.push(withIdMap(teamName || "Team", names, extractIdMap(pl)));
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
      if (names.length) out.push(withIdMap(teamName || "Team", names, extractIdMap(pl)));
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
      if (names.length) out.push(withIdMap(teamName || "Squad", names, extractIdMap(players)));
    }
    if (out.length) return out;
  }

  // CricAPI match_scorecard: playing XI (≤11, no super-sub) once batting exists; else fall through for full squad.
  const scorecard = (data as MaybeRecord).scorecard;
  if (Array.isArray(scorecard) && scorecard.length > 0) {
    const dataRec = data as MaybeRecord;
    const notStarted = providerPayloadSaysMatchNotStarted(dataRec);
    if (!(notStarted && !scorecardMatchHasBegun(scorecard))) {
      if (scorecardMatchHasBegun(scorecard)) {
        const eleven = extractPlayingElevenSquadsFromScorecard(dataRec, scorecard);
        const n = eleven.reduce((a, t) => a + t.players.length, 0);
        if (eleven.length >= 2 && n >= 11) return eleven;
        const merged = extractMergedSquadsFromScorecard(dataRec, scorecard);
        if (merged.length) return merged;
      } else {
        const eleven = extractPlayingElevenSquadsFromScorecard(dataRec, scorecard);
        if (eleven.length >= 2) return eleven;
      }
    }
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
      if (names.length) out.push(withIdMap(teamName || "Team", names, extractIdMap(players as any[])));
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
      if (names.length) out.push(withIdMap(teamName || "Team", names, extractIdMap(pl)));
    }
    if (out.length) return out;
  }

  return [];
}

function extractSquadsFromBatting(data: MaybeRecord): SquadTeam[] {
  const batting = data.batting;
  if (!Array.isArray(batting)) return [];
  const inningsSides = batting.map((inn) => parseInningBattingSideName(inn)).filter(Boolean);
  const byTeam = new Map<string, Set<string>>();
  const add = (team: string, name: string) => {
    if (!team || !name || name.toLowerCase() === "extras") return;
    if (!byTeam.has(team)) byTeam.set(team, new Set());
    byTeam.get(team)!.add(name);
  };
  for (const inn of batting) {
    const battingTeam = parseInningBattingSideName(inn);
    if (!battingTeam) continue;
    const bowlingTeam = resolveFieldingTeamName(battingTeam, inningsSides, data);

    const scores = (inn as any).scores;
    if (Array.isArray(scores)) {
      for (const row of scores) {
        const cells = Array.isArray(row) ? row : [row];
        for (const cell of cells) {
          const b = safeString((cell as any)?.batsman || (cell as any)?.name);
          if (b) add(battingTeam, b);
        }
      }
    }

    const batsmen = (inn as any).batsman ?? (inn as any).batsmen;
    if (Array.isArray(batsmen)) {
      for (const b of batsmen) {
        const name = safeString((b as any).batsman || (b as any).name || (b as any).fullName);
        if (name) add(battingTeam, name);
      }
    }

    if (bowlingTeam) {
      const bowlers = (inn as any).bowler ?? (inn as any).bowlers;
      if (Array.isArray(bowlers)) {
        for (const b of bowlers) {
          const name = safeString((b as any).bowler || (b as any).name || (b as any).fullName);
          if (name) add(bowlingTeam, name);
        }
      }
    }
  }
  const order = [...new Set(inningsSides)];
  const out: SquadTeam[] = [];
  for (const [teamName, set] of byTeam) {
    if (set.size) out.push({ teamName, players: [...set] });
  }
  out.sort((a, b) => {
    const ia = order.indexOf(a.teamName);
    const ib = order.indexOf(b.teamName);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  return out;
}

function squadPlayerCount(squads: SquadTeam[]) {
  return squads.reduce((n, t) => n + t.players.length, 0);
}

/** When structured squad endpoints parse to nothing, use any names we already extracted for stats sync. */
function squadsFromProviderPlayerRows(players: PlayerStats[] | undefined | null): SquadTeam[] {
  if (!Array.isArray(players) || players.length === 0) return [];
  const names: string[] = [];
  const idMap: Record<string, string> = {};
  const seen = new Set<string>();
  for (const p of players) {
    const n = safeString(p.name);
    if (!n) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    names.push(n);
    if (p.id) idMap[k] = p.id;
  }
  names.sort((a, b) => a.localeCompare(b));
  if (!names.length) return [];
  return [withIdMap("Players (from match feed)", names, idMap)];
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
      if (squadPlayerCount(squads) > 0) return squads;
    } catch {
      // try next path
    }
  }
  return [];
}

/**
 * Pull roster for the select UI.
 *
 * Cost target: 1 API call for live/completed matches (scorecard has the playing XI).
 *              2-3 calls for pre-match (scorecard fails → match_info → match_squad).
 *
 * We only make additional calls when the scorecard returns no usable player data.
 */
export async function fetchMatchRoster(externalMatchId: string): Promise<{ squads: SquadTeam[]; rosterNames: string[]; nameToId: Record<string, string> }> {
  const id = encodeURIComponent(externalMatchId);

  // Step 1: scorecard (1 API call).  Returns playing XI for live/completed, empty for pre-match.
  let full: ProviderRefresh | null = null;
  try {
    full = await refreshMatchFromProvider(externalMatchId);
  } catch {
    full = null;
  }

  // If we already have enough players from the scorecard, return immediately (no extra calls).
  if (full && squadPlayerCount(full.squads) >= 11) {
    return { squads: full.squads, rosterNames: full.rosterNames, nameToId: full.nameToId };
  }

  // Also accept stat-derived names as a squad when squads is thin.
  const fromStats = squadsFromProviderPlayerRows(full?.players);
  if (full && squadPlayerCount(fromStats) >= 11) {
    return { squads: fromStats, rosterNames: uniqueRosterNames(fromStats), nameToId: buildNameToId(fromStats) };
  }

  // Collect what we have and try cheaper endpoints only if needed.
  const candidates: SquadTeam[][] = [];
  if (full && squadPlayerCount(full.squads) > 0) candidates.push(full.squads);
  if (squadPlayerCount(fromStats) > 0) candidates.push(fromStats);

  // Step 2: match_info (1 API call) — works pre-match and returns full squad/teamInfo.
  if (isCricapiBase(envBaseUrl())) {
    try {
      const payload = await fetchJson(`/v1/match_info?id=${id}`);
      if (payload?.status !== "failure") {
        const s = extractSquadsFromPayload(payload);
        if (squadPlayerCount(s) > 0) candidates.push(s);
        // If match_info gave us enough players, stop here.
        if (squadPlayerCount(s) >= 11) {
          const best = candidates.sort((a, b) => squadPlayerCount(b) - squadPlayerCount(a))[0]!;
          return { squads: best, rosterNames: uniqueRosterNames(best), nameToId: buildNameToId(best) };
        }
      }
    } catch { /* ignore */ }
  }

  // Step 3: match_squad (1-2 API calls) — pre-match squad announcement.
  try {
    const s = await tryFetchSquadsFromSquadApi(externalMatchId);
    if (squadPlayerCount(s) > 0) candidates.push(s);
  } catch { /* ignore */ }

  if (candidates.length === 0) {
    return { squads: [], rosterNames: [], nameToId: {} };
  }
  const best = candidates.sort((a, b) => squadPlayerCount(b) - squadPlayerCount(a))[0];
  return { squads: best, rosterNames: uniqueRosterNames(best), nameToId: buildNameToId(best) };
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

  // Try paths one at a time; stop as soon as we get a response with player/squad data.
  // Only fall through to the next path when the current one has no usable content.
  for (const path of candidatePaths) {
    try {
      const p = await fetchJson(path);
      if (p?.status === "failure") {
        scorecardFailed = true;
        const r = safeString(p.reason || p.message || p.error || "");
        if (r) lastFailReason = r;
        continue;
      }
      if (!p) continue;
      // Accept this response if it has any player rows or squad data
      const data = ((p as MaybeRecord).data ?? p) as MaybeRecord;
      const probe: PlayerStats[] = [];
      if (data && typeof data === "object") collectPlayerRows(data, probe);
      const sq = extractSquadsFromPayload(p as MaybeRecord);
      if (probe.length > 0 || squadPlayerCount(sq) > 0) {
        payload = p as MaybeRecord;
        break;
      }
      // Response is valid but empty — keep it as a fallback and try next path
      if (!payload) payload = p as MaybeRecord;
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
      nameToId: {},
      raw: undefined,
    };
  }

  const data = payload.data || payload;
  const rows: PlayerStats[] = [];
  collectPlayerRows(data, rows);
  // Add wicket-fielder catches (newer CricAPI format) into the raw rows first
  rows.push(...extractCatchesFromWickets(data as MaybeRecord));
  // Merge by exact lowercase key first
  const mergedRaw = mergePlayers(rows);
  // Then patch catches from dismissal-text using variant-based matching.
  // This handles name mismatches like "Phil Salt" (dismissal-text) vs
  // "Philip Salt" (batting row) which would otherwise be separate keys.
  const catchRowsFromDismissals = extractCatchesFromBattingDismissals(data as MaybeRecord);
  const merged = patchCatches(mergedRaw, catchRowsFromDismissals);
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
    nameToId: buildNameToId(squads),
    raw: payload,
  };
}
