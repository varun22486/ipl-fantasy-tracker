import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("series_settings")
    .select("*")
    .limit(1)
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, settings: data });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const allowed = [
      "your_name", "opponent_name",
      "pts_run", "pts_wicket", "pts_catch", "pts_runout", "pts_stump",
      "pts_fifty", "pts_hundred", "pts_three_w", "pts_five_w", "pts_mom",
    ];

    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("series_settings")
      .update(updates)
      .gt("id", 0); // update all rows (there's only one)

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? "Unknown error" }, { status: 500 });
  }
}
