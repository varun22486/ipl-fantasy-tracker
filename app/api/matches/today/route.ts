import { NextResponse } from "next/server";
import type { MatchSeed } from "@/lib/cricket-provider";
import {
  filterMatchSeedsForLinkPicker,
  getIplMatchChoicesForToday,
  sortMatchSeedsLikeHistory,
} from "@/lib/cricket-provider";
import { getExternalMatchIdsPlayedInFantasy } from "@/lib/fantasy-played-external-ids";
import { loadMatchSeedsFromCatalogForWindow } from "@/lib/ipl-fixture-catalog";
import { parseCompetitionId } from "@/lib/competition-id";
import { iplCalendarTodayIso } from "@/lib/next-match";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const refresh = url.searchParams.get("refresh") === "1";
    const competitionId = parseCompetitionId(url.searchParams.get("c"));

    const playedExternalIds = await getExternalMatchIdsPlayedInFantasy(competitionId);

    const { data: dbMatches } = await supabaseAdmin
      .from("matches")
      .select("id, external_match_id")
      .order("id", { ascending: false });

    const linkedExternalIds = new Set<string>();
    for (const row of dbMatches ?? []) {
      const x = row.external_match_id;
      if (typeof x === "string" && x.trim()) linkedExternalIds.add(x.trim());
    }

    const todayIso = iplCalendarTodayIso();

    const date = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date());

    const applyLinkPickerFilter = (
      rawChoices: MatchSeed[],
      totalRaw: number,
      nonIplSample: string[],
      source: "api" | "cache"
    ) => {
      const sorted = sortMatchSeedsLikeHistory(rawChoices, dbMatches ?? []);
      const before = sorted.length;
      const choices = filterMatchSeedsForLinkPicker(sorted, playedExternalIds, linkedExternalIds, todayIso);
      const emptyReason =
        before > 0 && choices.length === 0 ? ("no_eligible_fixtures" as const) : undefined;
      return NextResponse.json({
        ok: true,
        choices,
        totalRaw,
        nonIplSample,
        date,
        source,
        ...(emptyReason ? { emptyReason } : {}),
      });
    };

    if (refresh) {
      const { choices: rawChoices, totalRaw, nonIplSample } = await getIplMatchChoicesForToday();
      return applyLinkPickerFilter(rawChoices, totalRaw, nonIplSample, "api");
    }

    let fromDb = await loadMatchSeedsFromCatalogForWindow();
    if (fromDb.length === 0) {
      const { choices: rawChoices, totalRaw, nonIplSample } = await getIplMatchChoicesForToday();
      return applyLinkPickerFilter(rawChoices, totalRaw, nonIplSample, "api");
    }

    return applyLinkPickerFilter(fromDb, fromDb.length, [], "cache");
  } catch (error) {
    // Pass the raw error through — classifyApiMsg on the client will render it correctly
    // with the right icon/colour. Avoid hardcoding key counts here.
    const msg = error instanceof Error ? error.message : "Could not load matches";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
