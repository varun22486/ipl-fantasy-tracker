import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const KEY_LIMIT = 100; // CricAPI free plan limit per key per day

export async function GET() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabaseAdmin
      .from("api_key_stats")
      .select("key_alias, hits, last_used_at")
      .eq("stat_date", today)
      .order("key_alias");

    if (error) throw error;

    const keyCount = [
      process.env.CRICKET_API_KEY,
      process.env.CRICKET_API_KEY_2,
      process.env.CRICKET_API_KEY_3,
      process.env.CRICKET_API_KEY_4,
      process.env.CRICKET_API_KEY_5,
    ].filter(Boolean).length;

    const stats = (data ?? []).map((row) => ({
      alias: row.key_alias,
      hits: row.hits,
      remaining: Math.max(0, KEY_LIMIT - (row.hits as number)),
      last_used_at: row.last_used_at,
    }));

    const totalHits = stats.reduce((s, r) => s + r.hits, 0);
    const totalRemaining = keyCount * KEY_LIMIT - totalHits;

    return NextResponse.json({
      ok: true,
      date: today,
      keyCount,
      keyLimit: KEY_LIMIT,
      stats,
      totalHits,
      totalRemaining,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to load key stats" },
      { status: 500 }
    );
  }
}
