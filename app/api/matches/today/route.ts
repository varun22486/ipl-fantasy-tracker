import { NextResponse } from "next/server";
import { getIplMatchChoicesForToday, sortMatchSeedsLikeHistory } from "@/lib/cricket-provider";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const [{ choices: rawChoices, totalRaw, nonIplSample }, { data: dbMatches }] = await Promise.all([
      getIplMatchChoicesForToday(),
      supabaseAdmin.from("matches").select("id, external_match_id").order("id", { ascending: false }),
    ]);
    const choices = sortMatchSeedsLikeHistory(rawChoices, dbMatches ?? []);

    const date = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date());

    return NextResponse.json({ ok: true, choices, totalRaw, nonIplSample, date });
  } catch (error) {
    // Pass the raw error through — classifyApiMsg on the client will render it correctly
    // with the right icon/colour. Avoid hardcoding key counts here.
    const msg = error instanceof Error ? error.message : "Could not load matches";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
