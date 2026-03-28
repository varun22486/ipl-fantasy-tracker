const DEFAULT_BASE_URL = "https://api.cricapi.com";

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

function pickApiKey(): string {
  const keys = [
    cleanEnvText(process.env.CRICKET_API_KEY),
    cleanEnvText(process.env.CRICKET_API_KEY_2),
  ].filter(Boolean) as string[];

  if (keys.length === 0) return "";
  return keys[Math.floor(Math.random() * keys.length)];
}

function authHeaders() {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const rapidHost = cleanEnvText(process.env.CRICKET_API_HOST);
  const apiKey = pickApiKey();
  if (rapidHost && apiKey) {
    headers["X-RapidAPI-Key"] = apiKey;
    headers["X-RapidAPI-Host"] = rapidHost;
  }

  return headers;
}

function withApiKey(path: string) {
  const apiKey = pickApiKey();
  if (!apiKey) return path;
  if (/([?&])apikey=/i.test(path)) return path;
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}apikey=${encodeURIComponent(apiKey)}`;
}

function isCricapiBase(baseUrl: string) {
  return /api\.cricapi\.com$/i.test(baseUrl);
}

async function fetchJson(path: string) {
  const requestPath = isCricapiBase(envBaseUrl()) ? withApiKey(path) : path;
  const response = await fetch(`${envBaseUrl()}${requestPath}`, {
    headers: authHeaders(),
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    throw new Error(`Provider request failed: ${response.status} ${path}`);
  }

  return response.json();
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
  const labelBase = extId ? `${sanitizeLabelPart(match_date)}_${sanitizeLabelPart(extId)}` : `${sanitizeLabelPart(match_date)}_${Date.now()}`;

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
    // Use only 2 API credits: currentMatches + recentMatches
    absorb(await fetchMatchArray("/v1/currentMatches?offset=0"));
    try {
      absorb(await fetchMatchArray("/v1/recentMatches?offset=0"));
    } catch {
      // recentMatches is best-effort; don't fail if quota just ran out after first call
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
export async function getIplMatchChoicesForToday(): Promise<{ choices: MatchSeed[]; totalRaw: number }> {
  const raw = await collectRawMatchesFromProvider();
  const ipl = raw.filter(isProbablyIplMatch);
  const byId = new Map<string, MatchSeed>();
  for (const m of ipl) {
    const s = matchToSeed(m);
    if (s.externalMatchId && !byId.has(s.externalMatchId)) byId.set(s.externalMatchId, s);
  }
  return {
    choices: [...byId.values()].sort(choiceDisplayOrder),
    totalRaw: raw.length,
  };
}

export async function getMatchSeedByExternalIdForToday(externalMatchId: string): Promise<MatchSeed | null> {
  const id = cleanEnvText(externalMatchId);
  if (!id) return null;
  const raw = await collectRawMatchesFromProvider();
  const hit = raw.find((m) => safeString(m.id || m.matchId || m.match_id) === id);
  if (hit && isProbablyIplMatch(hit)) return matchToSeed(hit);

  if (isCricapiBase(envBaseUrl())) {
    try {
      const payload = await fetchJson(`/v1/match_info?id=${encodeURIComponent(id)}`);
      const m = payload?.data ?? payload;
      if (m && typeof m === "object" && !Array.isArray(m) && isProbablyIplMatch(m)) {
        return matchToSeed(m);
      }
    } catch {
      // ignore
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
    for (const item of node) collectPlayerRows(item, bucket);
    return;
  }

  if (typeof node !== "object") return;

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
    "runs",
    "r",
    "batRuns",
    "batsmanRuns",
    "wickets",
    "w",
    "bowlWkts",
    "catches",
    "c",
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
      catches: Math.max(existing.catches, row.catches),
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

  return [];
}

function extractSquadsFromBatting(data: MaybeRecord): SquadTeam[] {
  const batting = data.batting;
  if (!Array.isArray(batting)) return [];
  const out: SquadTeam[] = [];
  for (const inn of batting) {
    const title = safeString((inn as any).title || "Batting");
    const scores = (inn as any).scores;
    if (!Array.isArray(scores)) continue;
    const set = new Set<string>();
    for (const row of scores) {
      const cells = Array.isArray(row) ? row : [row];
      for (const cell of cells) {
        const b = safeString((cell as any)?.batsman || (cell as any)?.name);
        if (!b || b.toLowerCase() === "extras") continue;
        set.add(b);
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

/** Pull squads / roster names from the same paths used for live score sync. */
export async function fetchMatchRoster(externalMatchId: string): Promise<{ squads: SquadTeam[]; rosterNames: string[] }> {
  const full = await refreshMatchFromProvider(externalMatchId);
  return { squads: full.squads, rosterNames: full.rosterNames };
}

export async function refreshMatchFromProvider(externalMatchId: string): Promise<ProviderRefresh> {
  const candidatePaths = isCricapiBase(envBaseUrl())
    ? [
        `/v1/match_scorecard?offset=0&id=${externalMatchId}`,
        `/v1/match_points?offset=0&id=${externalMatchId}`,
      ]
    : [
        `/v1/score/${externalMatchId}`,
        `/v1/scorecard/${externalMatchId}`,
        `/matches/get-scorecard?matchId=${externalMatchId}`,
        `/matches/get-scorecard-v2?matchId=${externalMatchId}`,
        `/v1/matches/${externalMatchId}/scorecard`,
      ];

  let payload: MaybeRecord | null = null;
  for (const path of candidatePaths) {
    try {
      payload = await fetchJson(path);
      if (payload) break;
    } catch {
      // try next path
    }
  }

  if (!payload) {
    throw new Error("Could not fetch scorecard data for the current match.");
  }

  const data = payload.data || payload;
  const rows: PlayerStats[] = [];
  collectPlayerRows(data, rows);
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
