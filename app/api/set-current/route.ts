import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const matchId = body?.matchId;
    const exclusive = body?.exclusive === true;
    if (!matchId || typeof matchId !== "number") {
      return NextResponse.json({ ok: false, error: "matchId required" }, { status: 400 });
    }
    if (exclusive) {
      await supabaseAdmin.from("matches").update({ is_current: false }).neq("id", matchId);
    }
    await supabaseAdmin.from("matches").update({ is_current: true }).eq("id", matchId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
