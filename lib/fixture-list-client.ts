import { recordSyncDebugClient } from "@/lib/sync-debug-storage";

/** Mirrors `/api/matches/today` choice rows (already sorted server-side). */
export type MatchChoice = {
  externalMatchId?: string;
  fixture: string;
  status: string;
  venue?: string | null;
  match_date: string;
  live_summary?: string | null;
};

export type MatchesTodayResponse = {
  ok: boolean;
  choices?: MatchChoice[];
  source?: "cache" | "api";
  date?: string;
  totalRaw?: number;
  nonIplSample?: string[];
  error?: string;
};

/**
 * Fetches the IPL fixture list. Order is defined only on the server
 * (`sortMatchSeedsLikeHistory`); clients must not re-sort.
 * Default path uses DB catalog when available; `refresh=true` forces provider + upsert.
 */
export async function fetchMatchesToday(
  refresh: boolean,
  opts?: { debugLabel?: string }
): Promise<MatchesTodayResponse> {
  const url = refresh ? "/api/matches/today?refresh=1" : "/api/matches/today";
  const res = await fetch(url);
  const json = (await res.json()) as MatchesTodayResponse;
  if (opts?.debugLabel) {
    recordSyncDebugClient(null, json as Record<string, unknown>, opts.debugLabel);
  }
  return json;
}

/** Client quota: only live API list pulls cost 2 credits. */
export function shouldDebitFixtureListCredits(source: MatchesTodayResponse["source"]): boolean {
  return source === "api";
}

export type ParsedFixtureList =
  | { kind: "picker"; choices: MatchChoice[]; source: "cache" | "api"; date: string }
  | { kind: "auto_link"; externalMatchId: string; source: "cache" | "api"; date: string }
  | { kind: "empty"; totalRaw: number; nonIplSample: string[]; source?: "cache" | "api" }
  | { kind: "error"; message: string };

export function parseMatchesTodayResponse(json: MatchesTodayResponse): ParsedFixtureList {
  if (!json.ok) {
    return { kind: "error", message: json.error || "Could not load matches." };
  }
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const source: "cache" | "api" = json.source === "cache" ? "cache" : "api";
  const date = typeof json.date === "string" ? json.date : "";
  if (choices.length === 0) {
    return {
      kind: "empty",
      totalRaw: json.totalRaw ?? 0,
      nonIplSample: Array.isArray(json.nonIplSample) ? json.nonIplSample : [],
      source: json.source as "cache" | "api" | undefined,
    };
  }
  if (choices.length === 1) {
    return { kind: "auto_link", externalMatchId: choices[0]!.externalMatchId || "", source, date };
  }
  return { kind: "picker", choices, source, date };
}

/** Shared copy for ApiMessage / toast when the feed has no IPL rows. */
export function emptyFixtureListCopy(totalRaw: number): { title: string; detail: string } {
  return {
    title:
      totalRaw === 0
        ? "No matches returned by the API right now"
        : `${totalRaw} match${totalRaw === 1 ? "" : "es"} in feed but none identified as IPL`,
    detail:
      totalRaw === 0
        ? "The CricAPI feed is empty — this can happen between match days or when all keys are rate-limited. Try again in a few minutes."
        : "The API returned matches but none matched the IPL filter. Check if the series ID in your environment is correct.",
  };
}

/** Plain string for dashboards that use a single message line (includes sample when helpful). */
export function emptyFixtureListPlainMessage(totalRaw: number, nonIplSample: string[]): string {
  const { title, detail } = emptyFixtureListCopy(totalRaw);
  if (totalRaw > 0 && nonIplSample.length > 0) {
    return `${title}. ${detail} Current feed sample: ${nonIplSample.join(", ")}.`;
  }
  return `${title} ${detail}`;
}

/** Banner when multiple fixtures are shown (order preserved from API). */
export function fixturePickerBannerCopy(
  count: number,
  source: "cache" | "api"
): { title: string; detail: string } {
  return {
    title: `${count} IPL fixtures found`,
    detail:
      source === "cache"
        ? "Loaded from saved list. Pick one below, or refresh from API if something is missing."
        : "Pick one below to link it.",
  };
}

/** Single-line status for dashboards that use plain `message` state. */
export function fixturePickerPlainMessage(count: number, source: "cache" | "api"): string {
  const { title, detail } = fixturePickerBannerCopy(count, source);
  return `${title} — ${detail}`;
}
