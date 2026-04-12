import { NextResponse } from "next/server";
import { getIplMatchChoicesForToday, sortMatchSeedsLikeHistory } from "@/lib/cricket-provider";
import { loadMatchSeedsFromCatalogForWindow } from "@/lib/ipl-fixture-catalog";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";

    const { data: dbMatches } = await supabaseAdmin
      .from("matches")
      .select("id, external_match_id")
      .order("id", { ascending: false });

    const date = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date());

    if (refresh) {
      const { choices: rawChoices, totalRaw, nonIplSample } = await getIplMatchChoicesForToday();
      const choices = sortMatchSeedsLikeHistory(rawChoices, dbMatches ?? []);
      return NextResponse.json({ ok: true, choices, totalRaw, nonIplSample, date, source: "api" as const });
    }

    let fromDb = await loadMatchSeedsFromCatalogForWindow();
    if (fromDb.length === 0) {
      const { choices: rawChoices, totalRaw, nonIplSample } = await getIplMatchChoicesForToday();
      const choices = sortMatchSeedsLikeHistory(rawChoices, dbMatches ?? []);
      return NextResponse.json({ ok: true, choices, totalRaw, nonIplSample, date, source: "api" as const });
    }

    const choices = sortMatchSeedsLikeHistory(fromDb, dbMatches ?? []);
    return NextResponse.json({
      ok: true,
      choices,
      totalRaw: fromDb.length,
      nonIplSample: [] as string[],
      date,
      source: "cache" as const,
    });
  } catch (error) {
    // Pass the raw error through — classifyApiMsg on the client will render it correctly
    // with the right icon/colour. Avoid hardcoding key counts here.
    const msg = error instanceof Error ? error.message : "Could not load matches";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
