import { NextRequest, NextResponse } from "next/server";
import { getMatchSeedByExternalIdForToday } from "@/lib/cricket-provider";
import { persistSeededMatch } from "@/lib/persist-seeded-match";

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
    let externalMatchId = "";
    try {
      const body = await req.json();
      externalMatchId = typeof body?.externalMatchId === "string" ? body.externalMatchId.trim() : "";
    } catch {
      // invalid or empty body
    }

    if (!externalMatchId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing externalMatchId. Pick a fixture from the list, then link the match.",
        },
        { status: 400 }
      );
    }

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
