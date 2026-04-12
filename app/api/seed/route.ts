import { NextRequest, NextResponse } from "next/server";
import { getMatchSeedByExternalIdForToday } from "@/lib/cricket-provider";
import { upsertMatchSeedCatalog } from "@/lib/ipl-fixture-catalog";
import { persistSeededMatch } from "@/lib/persist-seeded-match";
import { seedPostSchema } from "@/lib/api-schemas";

/** Manual link: POST with externalMatchId. Scheduled auto-link: GET /api/cron/auto-link-ipl (Bearer CRON_SECRET). */
export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Use POST with externalMatchId to link a match, or configure the daily cron at /api/cron/auto-link-ipl.",
    },
    { status: 405 }
  );
}

export async function POST(req: NextRequest) {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      raw = {};
    }
    const parsed = seedPostSchema.safeParse(raw);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Invalid request body";
      return NextResponse.json({ ok: false, error: msg, code: "VALIDATION" }, { status: 400 });
    }
    const externalMatchId = parsed.data.externalMatchId;

    const discovered = await getMatchSeedByExternalIdForToday(externalMatchId);
    if (!discovered) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Could not find that fixture via the API. The match may be too old for the live feed — try refreshing the list or check your API quota.",
        },
        { status: 400 }
      );
    }
    const match = await persistSeededMatch(discovered);
    await upsertMatchSeedCatalog(discovered);
    return NextResponse.json({ ok: true, match });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Seed failed",
      },
      { status: 500 }
    );
  }
}
