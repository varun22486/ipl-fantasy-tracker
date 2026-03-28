import { NextResponse } from "next/server";
import { getIplMatchChoicesForToday } from "@/lib/cricket-provider";

export async function GET() {
  try {
    const { choices, totalRaw } = await getIplMatchChoicesForToday();

    const date = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date());

    return NextResponse.json({ ok: true, choices, totalRaw, date });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not load matches";
    const isQuota = msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("limit") || msg.toLowerCase().includes("block");
    return NextResponse.json(
      {
        ok: false,
        error: isQuota
          ? `CricketData API quota reached — the free plan allows 100 requests/day. Try again tomorrow or upgrade your plan at cricketdata.org. (${msg})`
          : msg,
      },
      { status: 500 }
    );
  }
}
