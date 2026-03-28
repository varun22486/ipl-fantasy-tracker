import { NextResponse } from "next/server";
import { getIplMatchChoicesForToday } from "@/lib/cricket-provider";

export async function GET() {
  try {
    const choices = await getIplMatchChoicesForToday();
    return NextResponse.json({
      ok: true,
      choices,
      date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "long", day: "numeric" }).format(new Date()),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not load today's matches",
      },
      { status: 500 }
    );
  }
}
