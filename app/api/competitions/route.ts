import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** GET /api/competitions — list all competitions */
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("competitions")
    .select("*")
    .order("id", { ascending: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, competitions: data ?? [] });
}

/** POST /api/competitions — create a new competition */
export async function POST(req: NextRequest) {
  try {
    const { name, player1_name, player2_name } = await req.json();
    if (!player1_name?.trim() || !player2_name?.trim())
      return NextResponse.json({ ok: false, error: "Both player names are required." }, { status: 400 });
    const { data, error } = await supabaseAdmin
      .from("competitions")
      .insert({ name: (name || `${player1_name} vs ${player2_name}`).trim(), player1_name: player1_name.trim(), player2_name: player2_name.trim() })
      .select("*")
      .single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, competition: data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

/** PATCH /api/competitions — update a competition */
export async function PATCH(req: NextRequest) {
  try {
    const { id, name, player1_name, player2_name } = await req.json();
    if (!id) return NextResponse.json({ ok: false, error: "id required." }, { status: 400 });
    const updates: Record<string, string> = {};
    if (name?.trim()) updates.name = name.trim();
    if (player1_name?.trim()) updates.player1_name = player1_name.trim();
    if (player2_name?.trim()) updates.player2_name = player2_name.trim();
    const { error } = await supabaseAdmin.from("competitions").update(updates).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

/** DELETE /api/competitions — delete a competition (and its player picks) */
export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ ok: false, error: "id required." }, { status: 400 });
    const { error } = await supabaseAdmin.from("competitions").delete().eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
