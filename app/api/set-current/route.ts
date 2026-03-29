import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  try {
    const { matchId } = await req.json();
    if (!matchId || typeof matchId !== "number") {
      return NextResponse.json({ ok: false, error: "matchId required" }, { status: 400 });
    }
    await supabaseAdmin.from("matches").update({ is_current: false }).neq("id", matchId);
    await supabaseAdmin.from("matches").update({ is_current: true }).eq("id", matchId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
