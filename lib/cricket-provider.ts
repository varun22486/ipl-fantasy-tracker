import { createClient } from "@supabase/supabase-js";
import {
  parseRunOutFieldersFromDismissalText,
  splitRunOutFieldersFromText,
} from "@/lib/runout-fielders";
import { formatUiDateTimeLong } from "@/lib/ui-time";
import { buildMomWebSearchQuery, searchWebForMom } from "@/lib/web-mom-search";

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

/** Cricket Data / CricAPI `info` object — source of truth for daily usage. */
type CricApiInfo = { hitsToday?: number; hitsUsed?: number; hitsLimit?: number; credits?: number };

function extractCricApiInfo(payload: any): CricApiInfo | null {
  const info = payload?.info;
  if (!info || typeof info !== "object") return null;
  return {
    hitsToday: typeof info.hitsToday === "number" ? info.hitsToday : undefined,
    hitsUsed: typeof info.hitsUsed === "number" ? info.hitsUsed : undefined,
    hitsLimit: typeof info.hitsLimit === "number" ? info.hitsLimit : undefined,
    credits: typeof info.credits === "number" ? info.credits : undefined,
  };
}

function defaultHitsLimit(info: CricApiInfo | null): number {
  const n = info?.hitsLimit;
  return typeof n === "number" && n > 0 ? n : 100;
}

/**
 * Merge API `info` + block flags into api_key_stats (no increment_key_hit — hits come from provider).
 */
async function persistKeyStatsFromCricapi(
  key: string,
  payload: any,
  opts: { rateLimitBlock?: boolean }
): Promise<void> {
  const db = getAdminClient();
  if (!db) return;
  const alias = keyAlias(key);
  const today = new Date().toISOString().slice(0, 10);
  const info = extractCricApiInfo(payload);
  const limit = defaultHitsLimit(info);
  const hitsFromApi = info?.hitsToday;

  const { data: existing } = await db
    .from("api_key_stats")
    .select("hits, rate_limited_until, quota_exhausted_at")
    .eq("key_alias", alias)
    .eq("stat_date", today)
    .maybeSingle();

  const hits =
    typeof hitsFromApi === "number"
      ? hitsFromApi
      : (existing?.hits as number | undefined) ?? 0;

  let rateLimitedUntil: string | null =
    (existing?.rate_limited_until as string | null) ?? null;
  if (opts.rateLimitBlock) {
    rateLimitedUntil = new Date(Date.now() + 16 * 60 * 1000).toISOString();
  }

  let quotaExhaustedAt: string | null = (existing?.quota_exhausted_at as string | null) ?? null;
  if (typeof hitsFromApi === "number") {
    if (hitsFromApi >= limit) quotaExhaustedAt = today;
    else quotaExhaustedAt = null;
  }

  const row = {
    key_alias: alias,
    stat_date: today,
    hits,
    last_used_at: new Date().toISOString(),
    rate_limited_until: rateLimitedUntil,
    quota_exhausted_at: quotaExhaustedAt,
  };

  await db.from("api_key_stats").upsert(row, { onConflict: "key_alias,stat_date" });
}

type KeyBlockType = "rate_limit" | "quota";

/**
 * Classify the CricAPI failure reason into a block type:
 * - "rate_limit" = "Blocked for 15 minutes" → skip for 16 min
 * - "quota"      = "hits today exceeded hits limit" → skip for rest of day
 */
function classifyBlock(reason: string): KeyBlockType | null {
  const r = reason.toLowerCase();
  // Short 15‑min throttle (CricAPI wording)
  if (r.includes("15 minutes") || r.includes("blocked for") || r.includes("too many requests") || r.includes("throttl"))
    return "rate_limit";
  // Daily / plan quota — classify before generic "limit" / "block" hits
  if (
    r.includes("hits today") ||
    r.includes("hits limit") ||
    r.includes("blocking since") ||
    r.includes("quota") ||
    (r.includes("exceeded") && (r.includes("hit") || r.includes("credit") || r.includes("daily")))
  )
    return "quota";
  return null;
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
  /** Run-out fielding credits (each listed fielder gets +1). */
  runouts: number;
  /** Wicket-keeper stumpings. */
  stumpings: number;
  fifty_bonus: number;
  hundred_bonus: number;
  three_w_bonus: number;
  five_w_bonus: number;
  /** Man of the Match — set from provider when announced */
  mom_bonus?: number;
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
  /** IST / provider listing day — persisted on sync so DB stays aligned with scorecard metadata */
  match_date?: string;
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
  /** When true, refresh should overwrite fantasy_players.mom_bonus from provider */
  manOfTheMatchSynced?: boolean;
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
    cleanEnvText(process.env.CRICKET_API_KEY_8),
    cleanEnvText(process.env.CRICKET_API_KEY_9),
    cleanEnvText(process.env.CRICKET_API_KEY_10),
    cleanEnvText(process.env.CRICKET_API_KEY_11),
  ].filter(Boolean) as string[];
}

/** Short alias shown in stats (first 8 chars of key). */
function keyAlias(key: string): string {
  return key.slice(0, 8);
}

/** Rotate starting key each fetchJson so sequential fallbacks spread across keys. */
let fetchKeyRotationCursor = 0;

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
  lastUsedAt: Date | null;
};

/** Past unblock time, wait this long before using the key again (staggered retry). */
const RATE_LIMIT_BUFFER_MS = 90_000;

function emptyKeyStatus(): KeyStatus {
  return { hits: 0, rateLimitedUntil: null, quotaExhaustedAt: null, lastUsedAt: null };
}

function statusForKey(k: string, local: Record<string, KeyStatus>): KeyStatus {
  return local[keyAlias(k)] ?? emptyKeyStatus();
}

/** Skip key if Cricket Data says daily cap hit (persisted) or 15‑min block (persisted) is still active. */
function isKeyBlockedForPrefetch(k: string, local: Record<string, KeyStatus>, today: string, nowMs: number): boolean {
  const s = statusForKey(k, local);
  if (s.quotaExhaustedAt === today) return true;
  if (s.rateLimitedUntil && s.rateLimitedUntil.getTime() + RATE_LIMIT_BUFFER_MS > nowMs) return true;
  return false;
}

function syncLocalFromPersist(
  key: string,
  payload: any,
  rateLimitBlock: boolean,
  today: string,
  local: Record<string, KeyStatus>
) {
  const alias = keyAlias(key);
  const info = extractCricApiInfo(payload);
  const limit = defaultHitsLimit(info);
  const prev = local[alias] ?? emptyKeyStatus();
  const hits = typeof info?.hitsToday === "number" ? info.hitsToday : prev.hits;
  let rateUntil = prev.rateLimitedUntil;
  if (rateLimitBlock) rateUntil = new Date(Date.now() + 16 * 60 * 1000);
  let quotaAt = prev.quotaExhaustedAt;
  if (typeof info?.hitsToday === "number") {
    quotaAt = info.hitsToday >= limit ? today : null;
  }
  local[alias] = {
    hits,
    rateLimitedUntil: rateUntil,
    quotaExhaustedAt: quotaAt,
    lastUsedAt: new Date(),
  };
}

function nextUtcMidnight(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
}

function formatRetryTime(ms: number): string {
  return formatUiDateTimeLong(ms);
}

function formatRetryHints(keys: string[], local: Record<string, KeyStatus>, today: string, nowMs: number): string {
  let earliestRateResume: number | null = null;
  let quotaCount = 0;
  for (const k of keys) {
    if (!k) continue;
    const s = statusForKey(k, local);
    if (s.quotaExhaustedAt === today) quotaCount++;
    if (s.rateLimitedUntil && s.rateLimitedUntil.getTime() + RATE_LIMIT_BUFFER_MS > nowMs) {
      const resume = s.rateLimitedUntil.getTime() + RATE_LIMIT_BUFFER_MS;
      if (earliestRateResume == null || resume < earliestRateResume) earliestRateResume = resume;
    }
  }
  const bits: string[] = [];
  if (earliestRateResume != null) {
    bits.push(`Earliest rate-limit retry: ${formatRetryTime(earliestRateResume)}`);
  }
  if (quotaCount > 0) {
    const qReset = nextUtcMidnight().getTime();
    bits.push(`Daily quota exhausted on ${quotaCount} key(s) — try again after ${formatRetryTime(qReset)} (next UTC day; shown in Eastern Time)`);
  }
  if (bits.length === 0) return "No timing hint (keys may be misconfigured).";
  return bits.join(" · ");
}

function buildNoKeysAvailableMessage(keys: string[], local: Record<string, KeyStatus>, today: string, nowMs: number): string {
  return `Cricket API error: all ${keys.length} key(s) unavailable. ${formatRetryHints(keys, local, today, nowMs)}`;
}

/**
 * Tries API keys using Cricket Data `info` as source of truth for hits/limit.
 * DB stores last `info` + 15‑min / daily flags so we do not call blocked keys early.
 */
async function fetchJson(path: string) {
  const baseUrl = envBaseUrl();
  const keys = allApiKeys();
  const today = new Date().toISOString().slice(0, 10);
  const nowMs = Date.now();

  if (keys.length === 0) {
    throw new Error("Cricket API error: no CRICKET_API_KEY / CRICKET_API_KEY_2…_11 configured");
  }

  const keyStatusMap = await (async (): Promise<Record<string, KeyStatus>> => {
    const db = getAdminClient();
    if (!db) return {};
    try {
      const { data, error } = await db
        .from("api_key_stats")
        .select("key_alias, hits, rate_limited_until, quota_exhausted_at, last_used_at")
        .eq("stat_date", today);
      if (!error && data) {
        const map: Record<string, KeyStatus> = {};
        for (const row of data) {
          map[row.key_alias as string] = {
            hits: (row.hits as number) ?? 0,
            rateLimitedUntil: row.rate_limited_until ? new Date(row.rate_limited_until as string) : null,
            quotaExhaustedAt: (row.quota_exhausted_at as string) ?? null,
            lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string) : null,
          };
        }
        return map;
      }
      const { data: simple } = await db
        .from("api_key_stats")
        .select("key_alias, hits, rate_limited_until, quota_exhausted_at, last_used_at")
        .eq("stat_date", today);
      const map: Record<string, KeyStatus> = {};
      for (const row of simple ?? []) {
        map[row.key_alias as string] = {
          hits: (row.hits as number) ?? 0,
          rateLimitedUntil: row.rate_limited_until ? new Date(row.rate_limited_until as string) : null,
          quotaExhaustedAt: (row.quota_exhausted_at as string) ?? null,
          lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string) : null,
        };
      }
      return map;
    } catch { return {}; }
  })();

  const local: Record<string, KeyStatus> = { ...keyStatusMap };

  const unblocked = keys.filter((k) => k && !isKeyBlockedForPrefetch(k, local, today, nowMs));

  let lastError = "";
  let skippedQuota = 0;
  let skippedRateLimit = 0;

  if (unblocked.length === 0) {
    throw new Error(buildNoKeysAvailableMessage(keys, local, today, nowMs));
  }

  unblocked.sort((a, b) => {
    const ha = statusForKey(a, local).hits;
    const hb = statusForKey(b, local).hits;
    if (ha !== hb) return ha - hb;
    const ta = statusForKey(a, local).lastUsedAt?.getTime() ?? 0;
    const tb = statusForKey(b, local).lastUsedAt?.getTime() ?? 0;
    return ta - tb;
  });

  const rot = fetchKeyRotationCursor % unblocked.length;
  fetchKeyRotationCursor++;
  const ordered = [...unblocked.slice(rot), ...unblocked.slice(0, rot)];

  for (const key of ordered) {
    if (isKeyBlockedForPrefetch(key, local, today, Date.now())) continue;

    const requestPath = isCricapiBase(baseUrl) ? injectKey(path, key) : path;
    const headers = buildHeaders(key);
    const response = await fetch(`${baseUrl}${requestPath}`, { headers, cache: "no-store" });
    if (!response.ok) {
      lastError = `HTTP ${response.status}`;
      continue;
    }
    const payload = await response.json();

    if (isQuotaError(payload)) {
      const reason = String(payload.reason || payload.message || "");
      let blockType = classifyBlock(reason);
      if (blockType == null) {
        blockType = /hit|credit|daily|quota|exceeded/i.test(reason) ? "quota" : "rate_limit";
      }
      const rateLimitBlock = blockType === "rate_limit";
      if (blockType === "quota") {
        lastError = `[QUOTA_EXHAUSTED] ${reason || "daily quota exceeded"}`;
        skippedQuota++;
      } else {
        lastError = `[RATE_LIMITED] ${reason || "rate-limit exceeded"}`;
        skippedRateLimit++;
      }
      await persistKeyStatsFromCricapi(key, payload, { rateLimitBlock }).catch(() => {});
      syncLocalFromPersist(key, payload, rateLimitBlock, today, local);
      continue;
    }

    await persistKeyStatsFromCricapi(key, payload, {}).catch(() => {});
    syncLocalFromPersist(key, payload, false, today, local);
    return payload;
  }

  const total = skippedQuota + skippedRateLimit;
  const summaryParts: string[] = [];
  if (skippedQuota > 0) summaryParts.push(`${skippedQuota} quota-exhausted`);
  if (skippedRateLimit > 0) summaryParts.push(`${skippedRateLimit} rate-limited`);
  const summary = summaryParts.length ? ` [${total} keys tried: ${summaryParts.join(", ")}]` : "";
  const now = Date.now();
  const retryHint = formatRetryHints(keys, local, today, now);
  throw new Error(`Cricket API error: ${lastError || "all keys failed"}${summary}. ${retryHint}`);
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

/**
 * IPL listing day in Asia/Kolkata. Prefer epoch / full ISO instants over plain `date` — CricAPI `dateTimeGMT`
 * must be converted to IST (slicing the UTC YYYY-MM-DD prefix is wrong around midnight IST).
 */
function extractProviderMatchDate(match: MaybeRecord): string | null {
  const ms =
    typeof match.ms === "number" && match.ms > 0
      ? match.ms
      : typeof match.dateTime === "number" && match.dateTime > 0
        ? match.dateTime
        : NaN;
  if (Number.isFinite(ms)) return formatDateInTimeZone(new Date(ms), IPL_TZ);

  const fromScheduleString = (raw: string): string | null => {
    const s = raw.trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return formatDateInTimeZone(new Date(t), IPL_TZ);
    const head = s.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;
    return null;
  };

  for (const s of [
    safeString(match.dateTimeGMT),
    safeString(match.startedAt),
    safeString(match.startDate),
  ]) {
    const d = fromScheduleString(s);
    if (d) return d;
  }

  const tp = match.timeAndPlace;
  if (tp && typeof tp === "object") {
    const d = fromScheduleString(safeString((tp as any).date));
    if (d) return d;
  }

  for (const s of [
    safeString(match.date),
    safeString(match.matchDate),
    safeString(match.match_date),
  ]) {
    const head = s.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;
  }

  return null;
}

/**
 * One CricAPI match_info call — for home/next-match display without scanning the full feed.
 * Uses the same matchToSeed / extractProviderMatchDate path as seeding.
 */
export async function fetchMatchSeedFromMatchInfo(externalMatchId: string): Promise<MatchSeed | null> {
  const id = cleanEnvText(externalMatchId);
  if (!id || !isCricapiBase(envBaseUrl())) return null;
  try {
    const payload = await fetchJson(`/v1/match_info?id=${encodeURIComponent(id)}`);
    const m = payload?.data ?? payload;
    if (m && typeof m === "object" && !Array.isArray(m)) {
      const mid = safeString((m as MaybeRecord).id || (m as MaybeRecord).matchId || (m as MaybeRecord).match_id || id) || id;
      return matchToSeed({ ...(m as MaybeRecord), id: mid });
    }
  } catch {
    /* quota / network */
  }
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
  // Definitive result first — feeds often prefix "Live:" even after "won by …" (e.g. rain-reduced games).
  if (
    lower.includes("won by") ||
    lower.includes("won the match") ||
    /\bbeat\b/.test(lower) ||
    /\bdefeat(ed)?\b/.test(lower) ||
    lower.includes("drew") ||
    lower.includes("tie") ||
    /\bmatch\s+(?:completed|ended)\b/.test(lower) ||
    /\binnings\s+completed\b/.test(lower) ||
    (/\b(?:completed|finished)\b/.test(lower) && !/\bnot\s+yet\s+(?:completed|finished)\b/.test(lower))
  ) {
    return "COMPLETED";
  }
  // Washout / NR before "vs" — fixtures like "No result - KKR vs PBKS" must not become SCHEDULED.
  if (
    /\bno\s+result\b/.test(lower) ||
    lower.includes("abandon") ||
    lower.includes("wash") ||
    /\bcalled off\b/.test(lower)
  ) {
    return "NO_RESULT";
  }
  if (lower.includes("live") || lower.includes("need") || lower.includes("won toss")) return "LIVE";
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
  // ±3 day window so gaps between matches still show the adjacent fixture
  const dayMs = 86_400_000;
  const windowDates = new Set(
    [-3, -2, -1, 0, 1, 2, 3].map((d) => formatDateInTimeZone(new Date(nowMs + d * dayMs), IPL_TZ))
  );

  const inWindow = matchList.filter((m) => {
    const d = extractProviderMatchDate(m);
    return d && windowDates.has(d);
  });
  if (inWindow.length > 0) return inWindow;

  // Fallback: up to 3 most recent past matches (so users can re-link completed games)
  const past = matchList
    .filter((m) => {
      const d = extractProviderMatchDate(m);
      return d && d <= today;
    })
    .sort((a, b) => (extractProviderMatchDate(b) ?? "").localeCompare(extractProviderMatchDate(a) ?? ""));
  if (past.length > 0) return past.slice(0, 3);

  // Fallback: next 3 upcoming matches
  const upcoming = matchList
    .filter((m) => {
      const d = extractProviderMatchDate(m);
      return d && d > today;
    })
    .sort((a, b) => (extractProviderMatchDate(a) ?? "").localeCompare(extractProviderMatchDate(b) ?? ""));
  return upcoming.slice(0, 3);
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
  const dateCmp = (b.match_date || "").localeCompare(a.match_date || "");
  if (dateCmp !== 0) return dateCmp;
  return a.fixture.localeCompare(b.fixture);
}

/**
 * Link IPL Match picker: same relative order as History (`matches.id` desc via row order).
 * Rows already linked appear first in that order; other feed fixtures use live/date fallback.
 */
export function sortMatchSeedsLikeHistory(
  choices: MatchSeed[],
  dbMatches: { id: number; external_match_id?: string | null }[]
): MatchSeed[] {
  const orderIdx = new Map<string, number>();
  let i = 0;
  for (const row of dbMatches) {
    const ext = cleanEnvText(row.external_match_id);
    if (ext && !orderIdx.has(ext)) orderIdx.set(ext, i++);
  }
  return [...choices].sort((a, b) => {
    const ea = cleanEnvText(a.externalMatchId);
    const eb = cleanEnvText(b.externalMatchId);
    const ia = ea ? orderIdx.get(ea) : undefined;
    const ib = eb ? orderIdx.get(eb) : undefined;
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return choiceDisplayOrder(a, b);
  });
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
    choices: [...byId.values()],
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
    mom_bonus: row.mom_bonus ?? 0,
    runouts: row.runouts ?? 0,
    stumpings: row.stumpings ?? 0,
    fifty_bonus: row.runs >= 50 ? 1 : 0,
    hundred_bonus: row.runs >= 100 ? 1 : 0,
    three_w_bonus: row.wickets >= 3 ? 1 : 0,
    five_w_bonus: row.wickets >= 5 ? 1 : 0,
  };
}

function isPlaceholderMomName(s: string): boolean {
  return /^(tba|tbd|n\/a|na|[-–—]|pending|not\s+announced|to\s+be\s+announced)$/i.test(safeString(s).trim());
}

/** Strip team / award clutter: `Mohammed Shami (SRH)`, trailing dash codes, etc. */
function stripMomDecorators(name: string): string {
  let s = safeString(name).trim();
  if (!s) return "";
  s = s.replace(/\s*[–—-]\s*[A-Z]{2,}.*$/i, "").trim();
  s = s.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function pickNameFromMomField(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const s = safeString(raw);
    return s || null;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const n = pickNameFromMomField(item);
      if (n) return n;
    }
    return null;
  }
  if (typeof raw === "object") {
    const o = raw as MaybeRecord;
    const nested =
      (o as MaybeRecord).player ??
      (o as MaybeRecord).Player ??
      (o as MaybeRecord).cricketPlayer ??
      (o as MaybeRecord).batsman ??
      (o as MaybeRecord).bowler;
    if (nested && nested !== raw) {
      const inner = pickNameFromMomField(nested);
      if (inner) return inner;
    }
    const n = safeString(
      o.name ??
        o.playerName ??
        o.fullName ??
        o.shortName ??
        o.shortname ??
        o.displayName ??
        o.text ??
        o.label ??
        o.title
    );
    return n || null;
  }
  return null;
}

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
    // Lowercase names (feeds often sentence-case: "yashasvi jaiswal was player of the match")
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
 * Official Fantasy API field name (string; "tba" / blank if not declared yet):
 * https://www.cricapi.com/fantasy-api/ — table lists `man-of-the-match` next to team / batting / bowling / fielding.
 * v1 `match_scorecard` may nest the same key under `data` or deeper; walk the full JSON to find it.
 */
const MAN_OF_THE_MATCH_JSON_KEYS = [
  "man-of-the-match",
  "player-of-the-match",
  "playerOfMatch",
  "playerOfTheMatch",
  "playerofthematch",
  "player_of_the_match",
  "manOfTheMatch",
  "man_of_the_match",
  "manOfMatch",
  "man_of_match",
  "matchManOfTheMatch",
  "matchPlayerOfTheMatch",
  "mom",
  "pom",
  "potm",
  "playerOfMatchAward",
] as const;

/** Depth-first search for documented MoM keys anywhere in the API payload. */
function findManOfTheMatchByKeyWalk(obj: unknown, depth = 0): string | null {
  if (depth > 18 || obj == null) return null;
  if (typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const x of obj) {
      const h = findManOfTheMatchByKeyWalk(x, depth + 1);
      if (h) return h;
    }
    return null;
  }
  const o = obj as MaybeRecord;
  for (const k of MAN_OF_THE_MATCH_JSON_KEYS) {
    if (Object.prototype.hasOwnProperty.call(o, k)) {
      const n = pickNameFromMomField(o[k]);
      if (n && !isPlaceholderMomName(n)) return n;
    }
  }
  for (const v of Object.values(o)) {
    const h = findManOfTheMatchByKeyWalk(v, depth + 1);
    if (h) return h;
  }
  return null;
}

function extractManOfTheMatchName(data: MaybeRecord, payloadRoot?: MaybeRecord): string | null {
  const keys = [...MAN_OF_THE_MATCH_JSON_KEYS];

  if (payloadRoot) {
    const deep = findManOfTheMatchByKeyWalk(payloadRoot);
    if (deep) return deep;
  }

  const tryRecord = (root: MaybeRecord | null | undefined): string | null => {
    if (!root || typeof root !== "object") return null;
    for (const k of keys) {
      const n = pickNameFromMomField((root as any)[k]);
      if (n && !isPlaceholderMomName(n)) return n;
    }
    const mi = root.matchInfo ?? root.match_info;
    if (mi && typeof mi === "object") {
      for (const k of keys) {
        const n = pickNameFromMomField((mi as any)[k]);
        if (n && !isPlaceholderMomName(n)) return n;
      }
    }
    const info = root.info;
    if (info && typeof info === "object") {
      for (const k of keys) {
        const n = pickNameFromMomField((info as any)[k]);
        if (n && !isPlaceholderMomName(n)) return n;
      }
    }
    const sc = root.scorecard;
    if (Array.isArray(sc)) {
      for (const inn of sc) {
        if (inn && typeof inn === "object") {
          for (const k of keys) {
            const n = pickNameFromMomField((inn as any)[k]);
            if (n && !isPlaceholderMomName(n)) return n;
          }
        }
      }
    }
    for (const block of [root.matchResult, root.result, root.summary, root.matchSummary, root.match_status]) {
      if (block && typeof block === "object") {
        for (const k of keys) {
          const n = pickNameFromMomField((block as MaybeRecord)[k]);
          if (n && !isPlaceholderMomName(n)) return n;
        }
      }
    }
    return null;
  };

  const seen = new Set<MaybeRecord>();
  const roots: MaybeRecord[] = [];
  if (data && typeof data === "object") roots.push(data);
  if (payloadRoot && payloadRoot !== data && typeof payloadRoot === "object") roots.push(payloadRoot);

  for (const root of roots) {
    if (seen.has(root)) continue;
    seen.add(root);
    const hit = tryRecord(root);
    if (hit) return hit;
  }

  const textBlobs = [
    safeString(data?.update),
    safeString(data?.status),
    safeString(data?.message),
    safeString((data as any)?.live_summary),
    safeString((data as any)?.liveSummary),
    safeString((data as any)?.matchStatus),
    safeString((data as any)?.match_status),
    safeString((data as any)?.notes),
    payloadRoot ? safeString((payloadRoot as any).message) : "",
  ];
  for (const blob of textBlobs) {
    const fromText = extractMomFromFreeText(blob);
    if (fromText) return fromText;
  }
  return null;
}

/** Map Muhammad/Mohd/M. spellings so API "Mohammad" matches roster "Mohammed". */
function momComparableName(s: string): string {
  return normalizeNameForMom(s).replace(/\b(moh?d\.?|md|muhamm?ad|mohamm?ed|muhamm?ed)\b/gi, "__m__");
}

function playerMatchesMomName(playerName: string, momRaw: string): boolean {
  const mom = stripMomDecorators(safeString(momRaw).trim());
  if (!mom || isPlaceholderMomName(mom)) return false;
  const pv = new Set(nameVariants(playerName));
  for (const v of nameVariants(mom)) {
    if (pv.has(v)) return true;
  }
  const pn = normalizeNameForMom(playerName);
  const mn = normalizeNameForMom(mom);
  if (pn && mn && (pn.includes(mn) || mn.includes(pn))) return true;
  const pc = momComparableName(playerName);
  const mc = momComparableName(mom);
  if (pc && mc && (pc === mc || pc.includes(mc) || mc.includes(pc))) return true;
  return false;
}

function normalizeNameForMom(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function applyManOfTheMatch(players: PlayerStats[], momName: string | null): { players: PlayerStats[]; synced: boolean } {
  if (!momName) return { players, synced: false };
  return {
    players: players.map((p) =>
      bonusify({
        ...p,
        mom_bonus: playerMatchesMomName(p.name, momName) ? 1 : 0,
      })
    ),
    synced: true,
  };
}

/**
 * When the API announces MoM but no scorecard row matched (sparse card, odd spelling, or MoM-only),
 * inject a zero-stat row so refresh can still map lineup names → mom_bonus via variants.
 */
function ensureMomPlayerRowOnPayload(players: PlayerStats[], momName: string | null): PlayerStats[] {
  if (!momName || !stripMomDecorators(momName)) return players;
  if (players.some((p) => (p.mom_bonus ?? 0) > 0)) return players;
  const label = stripMomDecorators(momName);
  return [
    ...players,
    bonusify({
      name: label,
      runs: 0,
      wickets: 0,
      catches: 0,
      runouts: 0,
      stumpings: 0,
      fifty_bonus: 0,
      hundred_bonus: 0,
      three_w_bonus: 0,
      five_w_bonus: 0,
      mom_bonus: 1,
    }),
  ];
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
        bucket.push(bonusify({ name, runs: 0, wickets: 0, catches: total, runouts: 0, stumpings: 0, fifty_bonus: 0, hundred_bonus: 0, three_w_bonus: 0, five_w_bonus: 0 }));
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
      runouts: 0,
      stumpings: 0,
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
      runouts: 0,
      stumpings: 0,
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
        runs: 0, wickets: 0, catches: numCatches, runouts: 0, stumpings: 0,
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
        runouts: 0,
        stumpings: 0,
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

  // Path 1: scorecard / batting innings[].wickets
  for (const inn of normalizeScorecardInningsArray(data as MaybeRecord)) {
    const wkts = (inn as any).wickets ?? (inn as any).fall_wickets ?? (inn as any).fallWickets;
    if (Array.isArray(wkts)) wkts.forEach(processWicket);
  }
  // Path 2: top-level wickets / fall_wickets
  const direct = (data as any).wickets ?? (data as any).fall_wickets ?? (data as any).fallWickets;
  if (Array.isArray(direct)) direct.forEach(processWicket);

  if (countByKey.size === 0) return [];

  return Array.from(countByKey.entries()).map(([key, total]) =>
    bonusify({
      name: nameByKey.get(key) ?? key,
      runs: 0, wickets: 0, catches: total, runouts: 0, stumpings: 0,
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
    const dt = safeString(b["dismissal-text"] ?? b.dismissalText ?? "");
    const dismissal = safeString(b.dismissal ?? b.howOut ?? "").toLowerCase();
    const looksCaught =
      dismissal.includes("catch") ||
      dismissal === "caught" ||
      dismissal === "cb" ||
      /^c[\s&]/i.test(dt);
    if (!looksCaught) return;

    // Priority 1: dismissal-text — CricAPI's structured `catcher` field is sometimes wrong
    // (e.g. keeper vs slip); "c Kuldeep Yadav b …" is authoritative.
    // Caught-and-bowled: API uses "c and b Name" (word "and") not only "c&b Name".
    if (dt) {
      const cnb = dt.match(/^c\s*(?:&|and)\s*b\s+(.+)/i);
      if (cnb) {
        const bowlerField = b.bowler;
        const id =
          bowlerField && typeof bowlerField === "object"
            ? safeString(bowlerField.id) || undefined
            : undefined;
        addCatch(cnb[1].trim(), id);
        return;
      }
      // "c Name b Bowler" — must run after c-and-b so "c and b X" is not parsed as catcher "and"
      const caught = dt.match(/^c\s+(.+?)\s+b\s+/i);
      if (caught) {
        const namePart = caught[1].trim();
        let id: string | undefined;
        const catcherField = b.catcher;
        if (catcherField && typeof catcherField === "object" && typeof catcherField.id === "string") {
          const cn = safeString(catcherField?.name ?? catcherField?.playerName ?? "");
          if (cn && cn.toLowerCase().trim() === namePart.toLowerCase()) {
            id = catcherField.id.trim();
          }
        }
        addCatch(namePart, id);
        return;
      }
    }

    // Priority 2: explicit catcher only when text didn't identify the fielder
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
      if (name) addCatch(name, id);
    }
  }

  for (const inn of normalizeScorecardInningsArray(data)) {
    scorecardInningsBattingRows(inn).forEach((row) => processBattingEntry(row));
  }

  if (countByKey.size === 0) return [];

  return Array.from(countByKey.entries()).map(([key, total]) =>
    bonusify({
      id: idByKey.get(key),
      name: nameByKey.get(key) ?? key,
      runs: 0, wickets: 0, catches: total, runouts: 0, stumpings: 0,
      fifty_bonus: 0, hundred_bonus: 0, three_w_bonus: 0, five_w_bonus: 0,
    })
  );
}

/**
 * Structured wicket rows with kind run-out / fielder list (CricAPI scorecard).
 */
function extractRunoutsFromWickets(data: MaybeRecord): PlayerStats[] {
  const countByKey = new Map<string, number>();
  const nameByKey = new Map<string, string>();

  function processWicket(w: any) {
    const kind = safeString(w.kind ?? w.howOut ?? w.dismissalKind ?? "");
    const dismissal = safeString(w.dismissal ?? w.desc ?? w.dismissalText ?? "");
    if (/hit\s*wicket/i.test(kind) || /hit\s*wicket/i.test(dismissal)) return;
    const isRunOut =
      /run[\s_-]*out|runout/i.test(kind) || /run[\s_-]*out|runout/i.test(dismissal);
    if (!isRunOut) return;

    const raw = w.fielder ?? w.fielders ?? w.fielder_player ?? w.assistants;
    const fielders: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const f of fielders) {
      const rawName =
        typeof f === "string"
          ? f.trim()
          : safeString(f?.name ?? f?.playerName ?? f?.fullName ?? "");
      if (!rawName) continue;
      for (const name of splitRunOutFieldersFromText(rawName)) {
        const key = name.toLowerCase();
        nameByKey.set(key, nameByKey.get(key) ?? name);
        countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
      }
    }
  }

  for (const inn of normalizeScorecardInningsArray(data as MaybeRecord)) {
    const wkts = (inn as any).wickets ?? (inn as any).fall_wickets ?? (inn as any).fallWickets;
    if (Array.isArray(wkts)) wkts.forEach(processWicket);
  }
  const direct = (data as any).wickets ?? (data as any).fall_wickets ?? (data as any).fallWickets;
  if (Array.isArray(direct)) direct.forEach(processWicket);

  if (countByKey.size === 0) return [];

  return Array.from(countByKey.entries()).map(([key, total]) =>
    bonusify({
      name: nameByKey.get(key) ?? key,
      runs: 0,
      wickets: 0,
      catches: 0,
      runouts: total,
      stumpings: 0,
      fifty_bonus: 0,
      hundred_bonus: 0,
      three_w_bonus: 0,
      five_w_bonus: 0,
    })
  );
}

/**
 * Batting dismissal text e.g. `run out (Sarfaraz Khan/Ruturaj Gaikwad)`.
 */
function extractRunoutsFromBattingDismissals(data: MaybeRecord): PlayerStats[] {
  const countByKey = new Map<string, number>();
  const nameByKey = new Map<string, string>();

  function addRunout(name: string) {
    const key = name.toLowerCase().trim();
    if (!key || key.length < 2) return;
    nameByKey.set(key, nameByKey.get(key) ?? name.trim());
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
  }

  function processBattingEntry(b: any) {
    const dt = safeString(b["dismissal-text"] ?? b.dismissalText ?? "");
    const dismissal = safeString(b.dismissal ?? b.howOut ?? "");
    if (/hit\s*wicket/i.test(dt) || /hit\s*wicket/i.test(dismissal)) return;
    if (!/run[\s_-]*out|runout/i.test(dt) && !/run[\s_-]*out|runout/i.test(dismissal)) return;

    let names = parseRunOutFieldersFromDismissalText(dt);
    if (names.length === 0) names = parseRunOutFieldersFromDismissalText(dismissal);
    for (const nm of names) addRunout(nm);
  }

  for (const inn of normalizeScorecardInningsArray(data)) {
    scorecardInningsBattingRows(inn).forEach((row) => processBattingEntry(row));
  }

  if (countByKey.size === 0) return [];

  return Array.from(countByKey.entries()).map(([key, total]) =>
    bonusify({
      name: nameByKey.get(key) ?? key,
      runs: 0,
      wickets: 0,
      catches: 0,
      runouts: total,
      stumpings: 0,
      fifty_bonus: 0,
      hundred_bonus: 0,
      three_w_bonus: 0,
      five_w_bonus: 0,
    })
  );
}

/**
 * Structured wicket rows — stumped (wicket-keeper credit).
 */
function extractStumpingsFromWickets(data: MaybeRecord): PlayerStats[] {
  const countByKey = new Map<string, number>();
  const nameByKey = new Map<string, string>();

  function processWicket(w: any) {
    const kind = safeString(w.kind ?? w.howOut ?? w.dismissalKind ?? "");
    const dismissal = safeString(w.dismissal ?? w.desc ?? w.dismissalText ?? "");
    const isStumped =
      /stump/i.test(kind) ||
      /stumped/i.test(kind) ||
      /stump/i.test(dismissal) ||
      /stumped/i.test(dismissal);
    if (!isStumped) return;

    const raw =
      w.fielder ??
      w.fielders ??
      w.wicketKeeper ??
      w.wicket_keeper ??
      w.keeper ??
      w.stumper;
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

  for (const inn of normalizeScorecardInningsArray(data as MaybeRecord)) {
    const wkts = (inn as any).wickets ?? (inn as any).fall_wickets ?? (inn as any).fallWickets;
    if (Array.isArray(wkts)) wkts.forEach(processWicket);
  }
  const direct = (data as any).wickets ?? (data as any).fall_wickets ?? (data as any).fallWickets;
  if (Array.isArray(direct)) direct.forEach(processWicket);

  if (countByKey.size === 0) return [];

  return Array.from(countByKey.entries()).map(([key, total]) =>
    bonusify({
      name: nameByKey.get(key) ?? key,
      runs: 0,
      wickets: 0,
      catches: 0,
      runouts: 0,
      stumpings: total,
      fifty_bonus: 0,
      hundred_bonus: 0,
      three_w_bonus: 0,
      five_w_bonus: 0,
    })
  );
}

/** Batting dismissal text e.g. `st Yastika Bhatia b Deepti Sharma`. */
function extractStumpingsFromBattingDismissals(data: MaybeRecord): PlayerStats[] {
  const countByKey = new Map<string, number>();
  const nameByKey = new Map<string, string>();
  const idByKey = new Map<string, string>();

  function addStump(name: string, id?: string) {
    const key = name.toLowerCase().trim();
    if (!key || key.length < 2) return;
    nameByKey.set(key, nameByKey.get(key) ?? name.trim());
    if (id && !idByKey.has(key)) idByKey.set(key, id);
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
  }

  function processBattingEntry(b: any) {
    const dt = safeString(b["dismissal-text"] ?? b.dismissalText ?? "");
    const dismissal = safeString(b.dismissal ?? b.howOut ?? "").toLowerCase();
    const looksStumped =
      dismissal.includes("stump") ||
      /^st\s+/i.test(dt.trim()) ||
      /\bstumped\b/i.test(dt);
    if (!looksStumped) return;

    if (dt) {
      const st = dt.match(/^st\s+(.+?)\s+b\s+/i);
      if (st) {
        const namePart = st[1].trim();
        let id: string | undefined;
        const keeperField = b.stumper ?? b.wicketKeeper ?? b.keeper ?? b.catcher;
        if (keeperField && typeof keeperField === "object" && typeof keeperField.id === "string") {
          const kn = safeString(keeperField?.name ?? keeperField?.playerName ?? "");
          if (kn && kn.toLowerCase().trim() === namePart.toLowerCase()) {
            id = keeperField.id.trim();
          }
        }
        addStump(namePart, id);
        return;
      }
    }

    const keeperField = b.stumper ?? b.wicketKeeper ?? b.keeper;
    if (keeperField) {
      const name =
        typeof keeperField === "string"
          ? keeperField
          : safeString(keeperField?.name ?? keeperField?.playerName ?? "");
      const id =
        keeperField && typeof keeperField === "object" && typeof keeperField.id === "string"
          ? keeperField.id.trim() || undefined
          : undefined;
      if (name) addStump(name, id);
    }
  }

  for (const inn of normalizeScorecardInningsArray(data)) {
    scorecardInningsBattingRows(inn).forEach((row) => processBattingEntry(row));
  }

  if (countByKey.size === 0) return [];

  return Array.from(countByKey.entries()).map(([key, total]) =>
    bonusify({
      id: idByKey.get(key),
      name: nameByKey.get(key) ?? key,
      runs: 0,
      wickets: 0,
      catches: 0,
      runouts: 0,
      stumpings: total,
      fifty_bonus: 0,
      hundred_bonus: 0,
      three_w_bonus: 0,
      five_w_bonus: 0,
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
    // No bare surname — avoids mapping two different players to the same variant (e.g. both "* Sharma").
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

function patchRunouts(merged: PlayerStats[], runRows: PlayerStats[]): PlayerStats[] {
  const idToIdx = new Map<string, number>();
  const variantToIdx = new Map<string, number>();
  merged.forEach((p, i) => {
    if (p.id) idToIdx.set(p.id, i);
    for (const v of nameVariants(p.name)) {
      if (!variantToIdx.has(v)) variantToIdx.set(v, i);
    }
  });

  const result = merged.map((p) => ({ ...p }));

  for (const rr of runRows) {
    if (rr.runouts <= 0) continue;
    let idx: number | undefined;
    if (rr.id) idx = idToIdx.get(rr.id);
    if (idx === undefined) {
      for (const v of nameVariants(rr.name)) {
        idx = variantToIdx.get(v);
        if (idx !== undefined) break;
      }
    }

    if (idx !== undefined) {
      result[idx] = bonusify({
        ...result[idx],
        runouts: Math.max(result[idx].runouts ?? 0, rr.runouts),
        id: result[idx].id ?? rr.id,
      });
    } else {
      result.push(bonusify({ ...rr }));
    }
  }

  return result;
}

function patchStumpings(merged: PlayerStats[], stumpRows: PlayerStats[]): PlayerStats[] {
  const idToIdx = new Map<string, number>();
  const variantToIdx = new Map<string, number>();
  merged.forEach((p, i) => {
    if (p.id) idToIdx.set(p.id, i);
    for (const v of nameVariants(p.name)) {
      if (!variantToIdx.has(v)) variantToIdx.set(v, i);
    }
  });

  const result = merged.map((p) => ({ ...p }));

  for (const sr of stumpRows) {
    if (sr.stumpings <= 0) continue;
    let idx: number | undefined;
    if (sr.id) idx = idToIdx.get(sr.id);
    if (idx === undefined) {
      for (const v of nameVariants(sr.name)) {
        idx = variantToIdx.get(v);
        if (idx !== undefined) break;
      }
    }

    if (idx !== undefined) {
      result[idx] = bonusify({
        ...result[idx],
        stumpings: Math.max(result[idx].stumpings ?? 0, sr.stumpings),
        id: result[idx].id ?? sr.id,
      });
    } else {
      result.push(bonusify({ ...sr }));
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
      runouts: Math.max(existing.runouts ?? 0, row.runouts ?? 0),
      stumpings: Math.max(existing.stumpings ?? 0, row.stumpings ?? 0),
      fifty_bonus: 0,
      hundred_bonus: 0,
      three_w_bonus: 0,
      five_w_bonus: 0,
      mom_bonus: Math.max(existing.mom_bonus ?? 0, row.mom_bonus ?? 0),
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
        runouts: 0,
        stumpings: 0,
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
        runouts: 0,
        stumpings: 0,
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
  const inningLabel = safeString(
    o?.inning || o?.inningsName || o?.title || o?.inningsTitle || o?.name || o?.team || o?.battingTeam || ""
  );
  const stripped = inningLabel
    .replace(/\s+\d+(?:st|nd|rd|th)\s+(inning|innings)\s*$/i, "")
    .replace(/\s+(inning|innings)\s*\d+\s*$/i, "")
    .trim();
  return stripped || inningLabel;
}

/** Innings list: CricAPI uses `scorecard`, newer feeds often use top-level `batting` (per-innings). */
function normalizeScorecardInningsArray(data: MaybeRecord): unknown[] {
  if (Array.isArray(data.scorecard) && data.scorecard.length > 0) return data.scorecard;
  const sc = (data as any).scoreCard;
  if (Array.isArray(sc) && sc.length > 0) return sc;
  if (Array.isArray(data.batting) && data.batting.length > 0) return data.batting;
  const innings = (data as any).innings;
  if (Array.isArray(innings) && innings.length > 0) return innings;
  return [];
}

/** Batting stat rows for one innings (`batting`, `batsman`, or `batsmen`). */
function scorecardInningsBattingRows(inn: unknown): unknown[] {
  const o = inn as MaybeRecord;
  if (Array.isArray(o?.batting) && o.batting.length > 0) return o.batting as unknown[];
  if (Array.isArray((o as any)?.batsman) && (o as any).batsman.length > 0) return (o as any).batsman;
  if (Array.isArray((o as any)?.batsmen) && (o as any).batsmen.length > 0) return (o as any).batsmen;
  return [];
}

/** Bowling stat rows for one innings (`bowling` or `bowlers`). */
function scorecardInningsBowlingRows(inn: unknown): unknown[] {
  const o = inn as MaybeRecord;
  if (Array.isArray(o?.bowling) && o.bowling.length > 0) return o.bowling as unknown[];
  if (Array.isArray((o as any)?.bowlers) && (o as any).bowlers.length > 0) return (o as any).bowlers;
  return [];
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

/** Prefer the candidate with the most total players (full squad over thin scorecard-derived lists). */
function pickPreferredRosterSquads(candidates: SquadTeam[][]): SquadTeam[] {
  const nonempty = candidates.filter((c) => c.length > 0 && squadPlayerCount(c) > 0);
  if (!nonempty.length) return [];
  const twoTeam = nonempty.filter((c) => c.length >= 2);
  const pool = twoTeam.length ? twoTeam : nonempty;
  const ranked = pool.slice();
  ranked.sort((a, b) => {
    const ma = a.length >= 2 ? 0 : 1;
    const mb = b.length >= 2 ? 0 : 1;
    if (ma !== mb) return ma - mb;
    return squadPlayerCount(b) - squadPlayerCount(a);
  });
  return ranked[0]!;
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
  const batting = normalizeScorecardInningsArray(data);
  if (!batting.length) return [];
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
 * Cost target: 1 refresh call (scorecard / match_info paths) plus match_squad when needed for full squads.
 */
export async function fetchMatchRoster(externalMatchId: string): Promise<{ squads: SquadTeam[]; rosterNames: string[]; nameToId: Record<string, string> }> {
  const id = encodeURIComponent(externalMatchId);

  // Step 1: refresh (scorecard / match_info + match_squad when fuller).
  let full: ProviderRefresh | null = null;
  try {
    full = await refreshMatchFromProvider(externalMatchId);
  } catch {
    full = null;
  }

  if (full && full.squads.length >= 2 && squadPlayerCount(full.squads) >= 16) {
    return { squads: full.squads, rosterNames: full.rosterNames, nameToId: full.nameToId };
  }

  const fromStats = squadsFromProviderPlayerRows(full?.players);
  if (full && squadPlayerCount(fromStats) >= 11) {
    return { squads: fromStats, rosterNames: uniqueRosterNames(fromStats), nameToId: buildNameToId(fromStats) };
  }

  // Collect what we have and try cheaper endpoints only if needed.
  const candidates: SquadTeam[][] = [];
  if (full && squadPlayerCount(full.squads) > 0) candidates.push(full.squads);
  if (squadPlayerCount(fromStats) > 0) candidates.push(fromStats);

  // Step 2: match_info — full squad / teamInfo (merge with other candidates below).
  if (isCricapiBase(envBaseUrl())) {
    try {
      const payload = await fetchJson(`/v1/match_info?id=${id}`);
      if (payload?.status !== "failure") {
        const s = extractSquadsFromPayload(payload);
        if (squadPlayerCount(s) > 0) candidates.push(s);
      }
    } catch { /* ignore */ }
  }

  // Step 3: match_squad — full squad list per team.
  try {
    const s = await tryFetchSquadsFromSquadApi(externalMatchId);
    if (squadPlayerCount(s) > 0) candidates.push(s);
  } catch { /* ignore */ }

  if (candidates.length === 0) {
    return { squads: [], rosterNames: [], nameToId: {} };
  }
  const best = pickPreferredRosterSquads(candidates);
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
    // Classify using the [TAG] prefixes written by fetchJson so regex matching is unambiguous
    const isQuotaExhausted = /\[QUOTA_EXHAUSTED\]/i.test(lastFailReason) ||
      /quota.?(exhausted|today|limit)|all.?keys.*(quota|exhausted)/i.test(lastFailReason);
    const isRateLimit = !isQuotaExhausted && (
      /\[RATE_LIMITED\]/i.test(lastFailReason) ||
      /\bblocked? for 15\b|rate.?limit|15.?min/i.test(lastFailReason)
    );
    const isPlanError = !isQuotaExhausted && !isRateLimit && (
      /plan|subscri|paid|unauthori|forbidden|access|403/i.test(lastFailReason) ||
      (scorecardFailed && !lastFailReason)
    );

    // Strip internal tags from the user-facing message
    const cleanReason = lastFailReason.replace(/\[(QUOTA_EXHAUSTED|RATE_LIMITED)\]\s*/gi, "").trim();

    const liveMsg = isQuotaExhausted
      ? `All API keys have hit today's quota. Try again tomorrow (resets at midnight). Key usage: /api/key-stats`
      : isRateLimit
      ? `All API keys are rate-limited — wait ~15 minutes then try again.`
      : isPlanError
      ? `Scorecard endpoint requires a paid CricAPI plan. Use ✏️ Edit to enter stats manually.`
      : cleanReason
      ? `Scorecard not available: ${cleanReason}. Use ✏️ Edit to enter stats manually.`
      : "Scorecard not available from the API for this match. Use ✏️ Edit to enter stats manually.";

    return {
      status: scorecardFailed ? "COMPLETED" : "LIVE",
      live_summary: liveMsg,
      fixture: undefined,
      match_date: undefined,
      venue: null,
      toss_winner: null,
      source_url: null,
      players: [],
      squads: [],
      rosterNames: [],
      nameToId: {},
      raw: undefined,
      manOfTheMatchSynced: false,
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
  const runRowsW = extractRunoutsFromWickets(data as MaybeRecord);
  const runRowsB = extractRunoutsFromBattingDismissals(data as MaybeRecord);
  const mergedWithRunouts = patchRunouts(patchRunouts(merged, runRowsW), runRowsB);
  const stRowsW = extractStumpingsFromWickets(data as MaybeRecord);
  const stRowsB = extractStumpingsFromBattingDismissals(data as MaybeRecord);
  const mergedWithStumps = patchStumpings(patchStumpings(mergedWithRunouts, stRowsW), stRowsB);
  const mergedOrLive = mergedWithStumps.length > 0 ? mergedWithStumps : parseSimpleLiveScore(data);

  const dataRec = data as MaybeRecord;
  const statusBlob = safeString(data.update || data.status || (payload as MaybeRecord).status || "");
  const statusEarly = parseStatus(statusBlob);
  /** Web MoM fallback is allowed when the match looks done, including when the feed mentions the award but `parseStatus` is still loose. */
  const looksFinished =
    statusEarly === "COMPLETED" ||
    /\b(won by|won the match|beat |defeat(ed)?|match ended)\b/i.test(statusBlob) ||
    /\bman of the match\b/i.test(statusBlob) ||
    /\bplayer of the match\b/i.test(statusBlob);

  const fixtureQ = safeString(data.title || data.fixture || data.name || "");
  const dateQ = extractProviderMatchDate(dataRec) || "";

  let momName = extractManOfTheMatchName(dataRec, payload as MaybeRecord);
  if (momName) {
    momName = stripMomDecorators(momName);
    if (!momName || isPlaceholderMomName(momName)) momName = null;
  }

  if (!momName && looksFinished && fixtureQ) {
    const fromSearch = await searchWebForMom(buildMomWebSearchQuery(fixtureQ, dateQ));
    if (fromSearch) {
      const w = stripMomDecorators(fromSearch);
      momName = w && !isPlaceholderMomName(w) ? w : null;
    }
  }

  let { players: withMom, synced: manOfTheMatchSynced } = applyManOfTheMatch(mergedOrLive, momName);

  /**
   * If the API had a MoM string that matched no scorecard row (wrong spelling, garbled field),
   * we still look up DDG + regex / optional AI — otherwise refresh never writes `mom_bonus`.
   */
  if (looksFinished && momName && !withMom.some((p) => (p.mom_bonus ?? 0) > 0) && fixtureQ) {
    const fromSearch = await searchWebForMom(buildMomWebSearchQuery(fixtureQ, dateQ));
    if (fromSearch) {
      const webMom = stripMomDecorators(fromSearch);
      if (webMom && !isPlaceholderMomName(webMom)) {
        const r2 = applyManOfTheMatch(mergedOrLive, webMom);
        momName = webMom;
        withMom = r2.players;
        manOfTheMatchSynced = r2.synced;
      }
    }
  }

  withMom = ensureMomPlayerRowOnPayload(withMom, momName);
  let squads = extractSquadsFromPayload(payload);
  let count = squadPlayerCount(squads);
  if (count < 8) {
    const fromBatting = extractSquadsFromBatting(dataRec);
    if (squadPlayerCount(fromBatting) > count) {
      squads = fromBatting;
      count = squadPlayerCount(squads);
    }
  }

  /** Prefer `match_squad` when it lists more players than the scorecard payload (skip extra API if we already have ~full squads). */
  if (isCricapiBase(envBaseUrl()) && count < 44) {
    try {
      const extra = await tryFetchSquadsFromSquadApi(externalMatchId);
      if (extra.length >= 2 && squadPlayerCount(extra) > count) {
        squads = extra;
        count = squadPlayerCount(squads);
      }
    } catch {
      /* ignore */
    }
  }

  let rosterNames = uniqueRosterNames(squads);
  if (rosterNames.length === 0 && withMom.length) {
    rosterNames = [...new Set(withMom.map((p) => p.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    squads = rosterNames.length ? [{ teamName: "From live scorecard", players: rosterNames }] : [];
  }

  const metaDate = extractProviderMatchDate(dataRec);
  return {
    status: parseStatus(safeString(data.update || data.status || payload.status || "LIVE")),
    live_summary: safeString(data.update || data.status || payload.message || "") || null,
    fixture: safeString(data.title || data.fixture || data.name || "") || undefined,
    match_date: metaDate || undefined,
    venue: safeString(data.venue || data.ground || "") || null,
    toss_winner: safeString(data.toss_winner || data.tossWinner || "") || null,
    source_url: safeString(data.url || data.source_url || "") || null,
    players: withMom,
    squads,
    rosterNames,
    nameToId: buildNameToId(squads),
    raw: payload,
    manOfTheMatchSynced,
  };
}
