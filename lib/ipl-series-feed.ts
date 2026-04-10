/**
 * Pure helpers for CricAPI `series_info.matchList`: IST calendar dates, date extraction
 * from varied provider shapes, and picking which fixtures to expose for linking/sync.
 */

/** Loose row shape from CricAPI (varies by endpoint). */
export type ProviderMatchRecord = Record<string, any>;

export const IPL_TZ = "Asia/Kolkata";

export function formatDateInTimeZone(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (y && m && day) return `${y}-${m}-${day}`;
  return d.toISOString().slice(0, 10);
}

export function todayIsoInIplTZ(): string {
  return formatDateInTimeZone(new Date(), IPL_TZ);
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function matchRecordId(m: ProviderMatchRecord): string {
  return safeString(m.id ?? m.matchId ?? m.match_id);
}

/**
 * IPL listing day in Asia/Kolkata. Prefer epoch / full ISO instants over plain `date` — CricAPI `dateTimeGMT`
 * must be converted to IST (slicing the UTC YYYY-MM-DD prefix is wrong around midnight IST).
 */
export function extractProviderMatchDate(match: ProviderMatchRecord): string | null {
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

  const fromRecord = (r: ProviderMatchRecord | null | undefined): string | null => {
    if (!r || typeof r !== "object" || Array.isArray(r)) return null;

    const ms =
      typeof r.ms === "number" && r.ms > 0
        ? r.ms
        : typeof r.dateTime === "number" && r.dateTime > 0
          ? r.dateTime
          : NaN;
    if (Number.isFinite(ms)) return formatDateInTimeZone(new Date(ms), IPL_TZ);

    const rawStart =
      typeof r.startTime === "number" && r.startTime > 0
        ? r.startTime
        : typeof r.startTimestamp === "number" && r.startTimestamp > 0
          ? r.startTimestamp
          : NaN;
    if (Number.isFinite(rawStart)) {
      const msVal = rawStart > 1e12 ? rawStart : rawStart * 1000;
      return formatDateInTimeZone(new Date(msVal), IPL_TZ);
    }

    for (const s of [
      safeString(r.dateTimeGMT),
      safeString(r.startedAt),
      safeString(r.startDate),
      safeString(r.matchStartDate),
    ]) {
      const d = fromScheduleString(s);
      if (d) return d;
    }

    for (const s of [safeString(r.date), safeString(r.matchDate), safeString(r.match_date)]) {
      const head = s.trim().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;
    }

    return null;
  };

  const direct = fromRecord(match);
  if (direct) return direct;

  const mi = match.matchInfo;
  if (mi && typeof mi === "object" && !Array.isArray(mi)) {
    const d = fromRecord(mi as ProviderMatchRecord);
    if (d) return d;
  }

  const sw = match.seriesAdWrapper;
  if (sw && typeof sw === "object" && !Array.isArray(sw)) {
    const inner = (sw as ProviderMatchRecord).matchInfo;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const d = fromRecord(inner as ProviderMatchRecord);
      if (d) return d;
    }
  }

  const tp = match.timeAndPlace;
  if (tp && typeof tp === "object" && !Array.isArray(tp)) {
    const d = fromScheduleString(safeString((tp as ProviderMatchRecord).date));
    if (d) return d;
  }

  return null;
}

function dedupeMatchList(arr: ProviderMatchRecord[]): ProviderMatchRecord[] {
  const seen = new Set<string>();
  const out: ProviderMatchRecord[] = [];
  for (let i = 0; i < arr.length; i++) {
    const m = arr[i];
    const id = matchRecordId(m);
    const key = id || `__row_${i}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/** Heuristic: fixture is in session so it should appear even if schedule fields are missing. */
export function isLikelyInPlayFromProviderStatus(match: ProviderMatchRecord): boolean {
  const st = safeString(match.status ?? match.state ?? match.overview ?? match.statusText).toLowerCase();
  if (st.includes("live")) return true;
  if (st.includes("innings")) return true;
  if (st.includes("won the toss")) return true;
  if (/\bopt(?:ed)?\s+to\b/.test(st)) return true;
  if (st.includes("need ")) return true;
  if (st.includes("trail ")) return true;
  return false;
}

export type PickSeriesWindowOptions = {
  /** Days before/after today (IST) to keep, e.g. 7 → ±7 days. Default 7. */
  windowHalfWidthDays?: number;
  maxPast?: number;
  maxUpcoming?: number;
  tailIfNoDates?: number;
};

/**
 * Choose which `series_info` rows to merge into the app feed. Prioritises in-play fixtures
 * and a wider IST date window; falls back to larger past/upcoming slices, then list tail.
 */
export function pickIplSeriesMatchesForFeedWindow(
  matchList: ProviderMatchRecord[],
  nowMs: number,
  options?: PickSeriesWindowOptions
): ProviderMatchRecord[] {
  if (matchList.length === 0) return [];

  const windowHalfWidthDays = options?.windowHalfWidthDays ?? 7;
  const maxPast = options?.maxPast ?? 12;
  const maxUpcoming = options?.maxUpcoming ?? 12;
  const tailIfNoDates = options?.tailIfNoDates ?? 18;

  const dayMs = 86_400_000;
  const today = formatDateInTimeZone(new Date(nowMs), IPL_TZ);
  const windowDates = new Set<string>();
  for (let d = -windowHalfWidthDays; d <= windowHalfWidthDays; d++) {
    windowDates.add(formatDateInTimeZone(new Date(nowMs + d * dayMs), IPL_TZ));
  }

  const inWindow = matchList.filter((m) => {
    const d = extractProviderMatchDate(m);
    return Boolean(d && windowDates.has(d));
  });

  const inPlay = matchList.filter((m) => isLikelyInPlayFromProviderStatus(m));

  const merged = dedupeMatchList([...inPlay, ...inWindow]);
  if (merged.length > 0) return merged;

  const past = matchList
    .filter((m) => {
      const d = extractProviderMatchDate(m);
      return Boolean(d && d <= today);
    })
    .sort((a, b) => (extractProviderMatchDate(b) ?? "").localeCompare(extractProviderMatchDate(a) ?? ""));
  if (past.length > 0) return past.slice(0, maxPast);

  const upcoming = matchList
    .filter((m) => {
      const d = extractProviderMatchDate(m);
      return Boolean(d && d > today);
    })
    .sort((a, b) => (extractProviderMatchDate(a) ?? "").localeCompare(extractProviderMatchDate(b) ?? ""));
  if (upcoming.length > 0) return upcoming.slice(0, maxUpcoming);

  return matchList.slice(-tailIfNoDates);
}
