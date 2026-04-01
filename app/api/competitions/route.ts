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

/** POST /api/competitions — create a new competition with 2+ players */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Accept either {players: string[]} or legacy {player1_name, player2_name}
    let players: string[] = [];
    if (Array.isArray(body.players)) {
      players = body.players.map((p: string) => String(p).trim()).filter(Boolean);
    } else if (body.player1_name) {
      players = [body.player1_name, body.player2_name].map((p: string) => String(p ?? "").trim()).filter(Boolean);
    }
    if (players.length < 2)
      return NextResponse.json({ ok: false, error: "At least 2 players are required." }, { status: 400 });

    const autoName = players.join(" · ");
    const compName = (body.name?.trim() || autoName);
    const { data, error } = await supabaseAdmin
      .from("competitions")
      .insert({
        name: compName,
        player1_name: players[0],
        player2_name: players[1],
        players,
      })
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
