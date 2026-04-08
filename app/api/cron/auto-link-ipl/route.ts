import { NextRequest, NextResponse } from "next/server";
import { getIplMatchChoicesForToday, sortMatchSeedsLikeHistory } from "@/lib/cricket-provider";
import { persistSeededMatch } from "@/lib/persist-seeded-match";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { iplCalendarTodayIso, normalizeMatchDateKey } from "@/lib/next-match";

export const dynamic = "force-dynamic";

/** Vercel / external cron: daily 8:00 AM Asia/Kolkata = 02:30 UTC (`30 2 * * *` in vercel.json). */
export const maxDuration = 60;

function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized — set CRON_SECRET and send Authorization: Bearer …" }, { status: 401 });
  }

  try {
    const today = iplCalendarTodayIso();
    const [{ choices: rawChoices, totalRaw }, { data: dbMatches }] = await Promise.all([
      getIplMatchChoicesForToday(),
      supabaseAdmin.from("matches").select("id, external_match_id").order("id", { ascending: false }),
    ]);

    const sorted = sortMatchSeedsLikeHistory(rawChoices, dbMatches ?? []);
    const todays = sorted.filter((s) => normalizeMatchDateKey(s.match_date) === today);

    const linked: { externalMatchId: string; dbId: number }[] = [];
    const errors: { externalMatchId: string; message: string }[] = [];

    for (const seed of todays) {
      if (!seed.externalMatchId) continue;
      const ext = seed.externalMatchId;
      try {
        const row = await persistSeededMatch(seed);
        linked.push({ externalMatchId: ext, dbId: Number(row.id) });
      } catch (e) {
        errors.push({ externalMatchId: ext, message: e instanceof Error ? e.message : String(e) });
      }
    }

    return NextResponse.json({
      ok: true,
      istDate: today,
      feedTotalRaw: totalRaw,
      iplChoicesInFeed: rawChoices.length,
      todaysFixtures: todays.length,
      linked,
      errors,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Auto-link failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
