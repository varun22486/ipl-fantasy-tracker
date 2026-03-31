import { NextResponse } from "next/server";
import { getIplMatchChoicesForToday } from "@/lib/cricket-provider";

export async function GET() {
  try {
    const { choices, totalRaw, nonIplSample } = await getIplMatchChoicesForToday();

    const date = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
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
