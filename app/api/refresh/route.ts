import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { refreshMatchFromProvider } from "@/lib/cricket-provider";
import { refreshPostSchema } from "@/lib/api-schemas";
import { getDefaultActiveMatchRowForSync } from "@/lib/active-match";
import { VOIDED_MATCH_FANTASY_SCORES, isPointsVoidedMatchStatus } from "@/lib/match-void";
import { createMatchSnapshot } from "@/lib/match-snapshot";
import { REFRESH_COOLDOWN_MS } from "@/lib/refresh-cooldown";

type SelectedPlayer = {
  id: number;
  name: string;
  side: "You" | "Rahul";
  provider_player_id?: string | null;
};

function normalizeName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function collapsedName(name: string) {
  return normalizeName(name).replace(/\s+/g, "");
}

function tokens(name: string) {
  return normalizeName(name).split(/\s+/).filter(Boolean);
}

/** Reject stored provider_player_id when it points at a different person (e.g. Kartik vs Jitesh Sharma — same team, wrong UUID from roster). */
function namesCompatible(fantasyName: string, providerRowName: string): boolean {
  const na = normalizeName(fantasyName);
  const nb = normalizeName(providerRowName);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = tokens(fantasyName);
  const tb = tokens(providerRowName);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta.length >= 2 && tb.length >= 2 && ta[ta.length - 1] === tb[tb.length - 1]) {
    const fa = ta[0];
    const fb = tb[0];
    if (fa === fb) return true;
    if (fa.startsWith(fb) || fb.startsWith(fa)) return true; // Phil / Philip
    return false;
  }
  return false;
}

/** Keys when ingesting provider rows — includes short forms so "J Sharma" from the API maps. */
function buildVariants(name: string) {
  const normalized = normalizeName(name);
  const tokenList = tokens(name);
  const variants = new Set<string>();

  if (normalized) variants.add(normalized);
  const collapsed = collapsedName(name);
  if (collapsed) variants.add(collapsed);

  if (tokenList.length >= 2) {
    const first = tokenList[0];
    const last = tokenList[tokenList.length - 1];
    variants.add(`${first} ${last}`);
    variants.add(`${first[0]} ${last}`);
    variants.add(`${first[0]}${last}`);
    // Do NOT add bare `last` (e.g. "sharma") — many players share a surname and
    // incomingByVariant only keeps the first mapping, so sync would copy the wrong player's runs.
  }

  return Array.from(variants).filter(Boolean);
}

/**
 * Keys when resolving a fantasy lineup name → scorecard row.
 * If the user picked a full first name ("Jitesh"), do not fall back to `j sharma`; that key may
 * already belong to an abbreviated or different scorecard row that was merged first (wrong runs).
 */
function buildFantasyLookupVariants(playerName: string) {
  const normalized = normalizeName(playerName);
  const tokenList = tokens(playerName);
  const variants = new Set<string>();
  if (normalized) variants.add(normalized);
  const collapsed = collapsedName(playerName);
  if (collapsed) variants.add(collapsed);
  if (tokenList.length >= 2) {
    const first = tokenList[0];
    const last = tokenList[tokenList.length - 1];
    variants.add(`${first} ${last}`);
    if (first.length <= 1) {
      variants.add(`${first[0]} ${last}`);
      variants.add(`${first[0]}${last}`);
    }
  }
  return Array.from(variants).filter(Boolean);
}

function findIncomingPlayer(
  playerName: string,
  incomingByVariant: Map<
    string,
    {
      name: string;
      runs: number;
      wickets: number;
      catches: number;
      runouts: number;
      stumpings: number;
      fifty_bonus: number;
      hundred_bonus: number;
      three_w_bonus: number;
      five_w_bonus: number;
      mom_bonus?: number;
    }
  >
) {
  for (const variant of buildFantasyLookupVariants(playerName)) {
    const hit = incomingByVariant.get(variant);
    if (hit) return hit;
  }
  return null;
}

function summarizeNames(names: string[], limit = 12) {
  return names.slice(0, limit);
}

/** CricAPI often drops completed fixtures; sync then returns "match not found" for the same id. */
function isFixtureDroppedByProviderError(liveSummary: unknown): boolean {
  const s = String(liveSummary ?? "").toLowerCase();
  if (!s) return false;
  if (/\binvalid\s+match\s+id\b/.test(s)) return true;
  if (!/\bnot found\b/.test(s)) return false;
  return /\bmatch\b/.test(s) || /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s);
}

/** Nothing useful to keep (empty or a previous API error string). */
function isPriorApiFailureBanner(summary: unknown): boolean {
  const s = String(summary ?? "").trim();
  if (!s) return true;
  return /scorecard not available/i.test(s) || /\bERR:\s*/i.test(s);
}

type RefreshPayload = Awaited<ReturnType<typeof refreshMatchFromProvider>>;

function userMessageWhenNoProviderPlayerRows(payload: RefreshPayload, preservedDroppedFixture: boolean): string {
  if (preservedDroppedFixture) {
    return "Finished matches often disappear from the feed; your saved summary and player stats were not overwritten.";
  }
  const sum = String(payload.live_summary || "");
  if (/\bneed\s+\d+\s+runs\b/i.test(sum)) {
    return "Live status updated, but the API returned no scorecard player rows — fantasy stats were not changed. Try sync again in a few minutes, confirm your CricAPI plan includes IPL scorecards, or use Edit to enter stats manually.";
  }
  return sum || "Scorecard not available from API — stats unchanged.";
}

function resolveSummaryAndStatusAfterRefresh(
  currentMatch: { live_summary?: string | null; status?: string | null },
  payload: RefreshPayload
): { live_summary: string | null | undefined; status: string | undefined; preservedDroppedFixture: boolean } {
  const dropped =
    payload.players.length === 0 &&
    isFixtureDroppedByProviderError(payload.live_summary) &&
    !isPriorApiFailureBanner(currentMatch.live_summary);

  if (dropped) {
    return {
      live_summary: currentMatch.live_summary ?? null,
      status: currentMatch.status ?? undefined,
      preservedDroppedFixture: true,
    };
  }
  return {
    live_summary: payload.live_summary ?? currentMatch.live_summary,
    status: payload.status || currentMatch.status || undefined,
    preservedDroppedFixture: false,
  };
}

/** All `matches` rows linked to the same CricAPI fixture (dedupe is normal; duplicates can exist from legacy data). */
async function loadMatchesSharingExternalId(externalMatchId: string | null | undefined): Promise<Record<string, unknown>[]> {
  const ext = String(externalMatchId ?? "").trim();
  if (!ext) return [];
  const { data, error } = await supabaseAdmin
    .from("matches")
    .select("*")
    .eq("external_match_id", ext)
    .order("id", { ascending: true });
  if (error || !data?.length) return [];
  return data as Record<string, unknown>[];
}

function maxLastSyncedMsAmong(rows: Record<string, unknown>[]): number {
  let max = 0;
  for (const row of rows) {
    const raw = row.last_synced_at;
    if (raw == null) continue;
    const t = new Date(String(raw)).getTime();
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
}

function buildIncomingLookups(payload: RefreshPayload) {
  const incomingById = new Map<string, (typeof payload.players)[number]>();
  const incomingByVariant = new Map<string, (typeof payload.players)[number]>();
  for (const player of payload.players) {
    if (player.id) incomingById.set(player.id, player);
    for (const variant of buildVariants(player.name)) {
      if (!incomingByVariant.has(variant)) incomingByVariant.set(variant, player);
    }
  }
  return { incomingById, incomingByVariant };
}

/**
 * Apply one provider payload to a single match row and all fantasy_players for that match (every competition).
 * Does not call the cricket API.
 */
async function applyRefreshPayloadToOneMatch(
  matchRow: Record<string, unknown>,
  payload: RefreshPayload,
  incomingById: Map<string, (typeof payload.players)[number]>,
  incomingByVariant: Map<string, (typeof payload.players)[number]>
): Promise<{
  updatedRows: number;
  selectedCount: number;
  matched: Array<{ selected: string; provider: string; matchedById: boolean }>;
  unmatched: string[];
}> {
  const matchId = Number(matchRow.id);
  const { data: selectedPlayers } = await supabaseAdmin
    .from("fantasy_players")
    .select("id,name,side,provider_player_id")
    .eq("match_id", matchId)
    .order("id", { ascending: true });

  const selected = (selectedPlayers ?? []) as SelectedPlayer[];
  const matched: Array<{ selected: string; provider: string; matchedById: boolean }> = [];
  const unmatched: string[] = [];
  let updatedRows = 0;

  for (const player of selected) {
    const idHit = player.provider_player_id ? incomingById.get(player.provider_player_id) : null;
    const idOk = Boolean(idHit && namesCompatible(player.name, idHit.name));
    const hit = idOk ? idHit! : findIncomingPlayer(player.name, incomingByVariant);
    if (!hit) {
      if (idHit && !idOk) {
        await supabaseAdmin
          .from("fantasy_players")
          .update({
            runs: 0,
            wickets: 0,
            catches: 0,
            runouts: 0,
            stumpings: 0,
            fifty_bonus: 0,
            hundred_bonus: 0,
            three_w_bonus: 0,
            five_w_bonus: 0,
            mom_bonus: 0,
            provider_player_id: null,
          })
          .eq("id", player.id);
        updatedRows += 1;
      }
      unmatched.push(player.name);
      continue;
    }

    matched.push({ selected: player.name, provider: hit.name, matchedById: idOk });

    const updatePayload: Record<string, unknown> = {
      runs: hit.runs,
      wickets: hit.wickets,
      catches: hit.catches,
      runouts: hit.runouts ?? 0,
      stumpings: hit.stumpings ?? 0,
      fifty_bonus: hit.fifty_bonus,
      hundred_bonus: hit.hundred_bonus,
      three_w_bonus: hit.three_w_bonus,
      five_w_bonus: hit.five_w_bonus,
    };
    if (payload.manOfTheMatchSynced) {
      updatePayload.mom_bonus = hit.mom_bonus ?? 0;
    }
    if (hit.id) {
      updatePayload.provider_player_id = hit.id;
    }

    await supabaseAdmin.from("fantasy_players").update(updatePayload).eq("id", player.id);
    updatedRows += 1;
  }

  const {
    live_summary: nextLiveSummary,
    status: nextStatus,
  } = resolveSummaryAndStatusAfterRefresh(matchRow, payload);

  const syncedAt = new Date().toISOString();
  await supabaseAdmin
    .from("matches")
    .update({
      status: nextStatus,
      fixture: payload.fixture || matchRow.fixture,
      ...(payload.match_date ? { match_date: payload.match_date } : {}),
      venue: payload.venue ?? matchRow.venue,
      toss_winner: payload.toss_winner ?? matchRow.toss_winner,
      live_summary: nextLiveSummary,
      source_url: payload.source_url ?? matchRow.source_url,
      last_synced_at: syncedAt,
      ...(payload.rosterNames.length > 0
        ? { provider_squad_json: { squads: payload.squads, rosterNames: payload.rosterNames } }
        : {}),
    })
    .eq("id", matchId);

  const resolvedStatus = String(nextStatus || matchRow.status || "");
  const liveSum = nextLiveSummary ?? matchRow.live_summary ?? null;
  const manualVoid = matchRow.fantasy_voided === true;
  if (manualVoid || isPointsVoidedMatchStatus(resolvedStatus, liveSum)) {
    await supabaseAdmin.from("fantasy_players").update(VOIDED_MATCH_FANTASY_SCORES).eq("match_id", matchId);
  }

  return { updatedRows, selectedCount: selected.length, matched, unmatched };
}

async function doRefresh(matchId?: number) {
  const explicit =
    typeof matchId === "number" && Number.isFinite(matchId) && matchId > 0 ? matchId : null;

  // Explicit id (e.g. from Sync on /match?m=…): load only that row — never fall back to another fixture.
  if (explicit != null) {
    const { data } = await supabaseAdmin.from("matches").select("*").eq("id", explicit).maybeSingle();
    return (data as Record<string, unknown> | null) ?? null;
  }

  let currentMatch: Record<string, unknown> | null = null;
  const row = await getDefaultActiveMatchRowForSync();
  currentMatch = row as typeof currentMatch;
  if (!currentMatch) {
    const { data } = await supabaseAdmin.from("matches").select("*").order("id", { ascending: false }).limit(1).maybeSingle();
    currentMatch = (data as Record<string, unknown> | null) ?? null;
  }

  return currentMatch;
}

export async function GET(request: Request) {
  try {
    const force = new URL(request.url).searchParams.get("force") === "1";
    const currentMatch = await doRefresh();

    if (!currentMatch?.external_match_id) {
      return NextResponse.json({ ok: false, error: "No seeded match with an external match id yet." }, { status: 400 });
    }

    let rowsToSync = await loadMatchesSharingExternalId(String(currentMatch.external_match_id));
    if (rowsToSync.length === 0) rowsToSync = [currentMatch as Record<string, unknown>];
    const now = Date.now();
    const lastSyncedMax = maxLastSyncedMsAmong(rowsToSync);

    if (!force && lastSyncedMax && now - lastSyncedMax < REFRESH_COOLDOWN_MS) {
      const mins = Math.max(1, Math.ceil((REFRESH_COOLDOWN_MS - (now - lastSyncedMax)) / 60_000));
      return NextResponse.json(
        {
          ok: false,
          code: "RECENT_SYNC",
          error: `Scores were synced recently. Wait about ${mins} min, or call with ?force=1 if you accept the API cost.`,
        },
        { status: 409 },
      );
    }

    for (const row of rowsToSync) {
      await createMatchSnapshot({
        matchId: Number(row.id),
        source: "pre_sync",
        summary: "Before API sync",
      });
    }

    const payload = await refreshMatchFromProvider(String(currentMatch.external_match_id), {
      storedProviderSquad: currentMatch.provider_squad_json,
    });

    const { incomingById, incomingByVariant } = buildIncomingLookups(payload);

    const primaryRow =
      rowsToSync.find((r) => Number(r.id) === Number(currentMatch.id)) ??
      (currentMatch as Record<string, unknown>);
    const { preservedDroppedFixture } = resolveSummaryAndStatusAfterRefresh(primaryRow, payload);

    let updatedRows = 0;
    let totalSelected = 0;
    const matched: Array<{ selected: string; provider: string; matchedById: boolean }> = [];
    const unmatched: string[] = [];

    for (const row of rowsToSync) {
      const r = await applyRefreshPayloadToOneMatch(row, payload, incomingById, incomingByVariant);
      updatedRows += r.updatedRows;
      totalSelected += r.selectedCount;
      matched.push(...r.matched);
      unmatched.push(...r.unmatched);
    }

    const syncedAt = new Date().toISOString();

    const {
      live_summary: nextLiveSummary,
      status: nextStatus,
    } = resolveSummaryAndStatusAfterRefresh(primaryRow, payload);

    const resolvedStatus = String(nextStatus || primaryRow.status || "");
    const liveSum = nextLiveSummary ?? primaryRow.live_summary ?? null;
    const manualVoid = primaryRow.fantasy_voided === true;
    const voided = manualVoid || isPointsVoidedMatchStatus(resolvedStatus, liveSum);

    const providerNames = payload.players.map((p) => p.name).filter(Boolean);
    const matchIdsSynced = rowsToSync.map((r) => Number(r.id));
    const multi = rowsToSync.length > 1;

    return NextResponse.json({
      ok: true,
      skipped: false,
      message: voided
        ? manualVoid
          ? "Match is voided — fantasy scores cleared (manual void)."
          : "Match voided (washout / no result) — fantasy scores cleared for this fixture."
        : payload.players.length === 0
          ? userMessageWhenNoProviderPlayerRows(payload, preservedDroppedFixture)
          : updatedRows > 0
          ? multi
            ? `Updated ${updatedRows} player row(s) across ${rowsToSync.length} linked match record(s) — one API fetch.`
            : `Updated ${updatedRows} of ${totalSelected} selected players.`
          : "Names in lineup didn't match the scorecard — check debug panel.",
      live_summary: nextLiveSummary ?? payload.live_summary,
      debug: {
        matchId: currentMatch.id,
        externalMatchId: currentMatch.external_match_id,
        matchIdsSynced,
        selectedCount: totalSelected,
        providerRowCount: payload.players.length,
        updatedRows,
        matched,
        unmatched,
        providerPlayersSample: summarizeNames(providerNames),
        rosterCount: payload.rosterNames.length,
        fixture: payload.fixture || currentMatch.fixture,
        status: payload.status || currentMatch.status,
        syncedAt,
        sourceUrl: payload.source_url ?? currentMatch.source_url,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Refresh failed",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    let raw: unknown = {};
    try {
      raw = await req.json();
    } catch {
      /* no body */
    }
    const parsed = refreshPostSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid matchId in request body.", code: "VALIDATION" },
        { status: 400 }
      );
    }
    const matchId = parsed.data.matchId;
    const force = parsed.data.force === true;

    const currentMatch = await doRefresh(matchId);

    if (!currentMatch) {
      return NextResponse.json(
        {
          ok: false,
          error: matchId != null ? `No match with id ${matchId}.` : "No match to sync.",
        },
        { status: matchId != null ? 404 : 400 }
      );
    }

    if (!currentMatch.external_match_id) {
      return NextResponse.json(
        { ok: false, error: "This match is not linked to CricAPI (missing external_match_id)." },
        { status: 400 }
      );
    }

    let rowsToSync = await loadMatchesSharingExternalId(String(currentMatch.external_match_id));
    if (rowsToSync.length === 0) rowsToSync = [currentMatch as Record<string, unknown>];
    const now = Date.now();
    const lastSyncedMax = maxLastSyncedMsAmong(rowsToSync);

    if (!force && lastSyncedMax && now - lastSyncedMax < REFRESH_COOLDOWN_MS) {
      const mins = Math.max(1, Math.ceil((REFRESH_COOLDOWN_MS - (now - lastSyncedMax)) / 60_000));
      return NextResponse.json(
        {
          ok: false,
          code: "RECENT_SYNC",
          error: `Scores were synced recently. Wait about ${mins} min, or confirm a refresh in the app to use another API call.`,
        },
        { status: 409 },
      );
    }

    for (const row of rowsToSync) {
      await createMatchSnapshot({
        matchId: Number(row.id),
        source: "pre_sync",
        summary: "Before API sync",
      });
    }

    const payload = await refreshMatchFromProvider(String(currentMatch.external_match_id), {
      storedProviderSquad: currentMatch.provider_squad_json,
    });

    const { incomingById, incomingByVariant } = buildIncomingLookups(payload);

    const primaryRow =
      rowsToSync.find((r) => Number(r.id) === Number(currentMatch.id)) ??
      (currentMatch as Record<string, unknown>);
    const { preservedDroppedFixture: preservedDroppedPost } = resolveSummaryAndStatusAfterRefresh(primaryRow, payload);

    let updatedRows = 0;
    let totalSelected = 0;
    const matched: Array<{ selected: string; provider: string; matchedById: boolean }> = [];
    const unmatched: string[] = [];

    for (const row of rowsToSync) {
      const r = await applyRefreshPayloadToOneMatch(row, payload, incomingById, incomingByVariant);
      updatedRows += r.updatedRows;
      totalSelected += r.selectedCount;
      matched.push(...r.matched);
      unmatched.push(...r.unmatched);
    }

    const syncedAt = new Date().toISOString();
    const {
      live_summary: nextLiveSummaryPost,
      status: nextStatusPost,
    } = resolveSummaryAndStatusAfterRefresh(primaryRow, payload);

    const resolvedStatus = String(nextStatusPost || primaryRow.status || "");
    const liveSum = nextLiveSummaryPost ?? primaryRow.live_summary ?? null;
    const manualVoid = primaryRow.fantasy_voided === true;
    const voided = manualVoid || isPointsVoidedMatchStatus(resolvedStatus, liveSum);

    const matchIdsSynced = rowsToSync.map((r) => Number(r.id));
    const multi = rowsToSync.length > 1;

    return NextResponse.json({
      ok: true,
      skipped: false,
      message: voided
        ? manualVoid
          ? "Match is voided — fantasy scores cleared (manual void)."
          : "Match voided (washout / no result) — fantasy scores cleared for this fixture."
        : payload.players.length === 0
          ? userMessageWhenNoProviderPlayerRows(payload, preservedDroppedPost)
          : updatedRows > 0 ? multi
            ? `Updated ${updatedRows} player row(s) across ${rowsToSync.length} linked match record(s) — one API fetch.`
            : `Updated ${updatedRows} of ${totalSelected} players.`
          : "Names in lineup didn't match the scorecard — check spelling.",
      live_summary: nextLiveSummaryPost ?? payload.live_summary,
      debug: {
        matchId: currentMatch.id,
        matchIdsSynced,
        externalMatchId: currentMatch.external_match_id,
        selectedCount: totalSelected,
        updatedRows,
        matched,
        unmatched,
        providerPlayersSample: summarizeNames(payload.players.map((p) => p.name)),
        syncedAt,
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Refresh failed" }, { status: 500 });
  }
}
