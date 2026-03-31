import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * POST /api/reset-key-blocks
 * Clears any rate-limit blocks on all keys so they can be retried immediately.
 * Safe to call when you believe the 15-min window has passed.
 */
export async function POST() {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Try to clear rate_limited_until (requires migration)
    const { error } = await supabaseAdmin
      .from("api_key_stats")
      .update({ rate_limited_until: null })
      .eq("stat_date", today)
      .not("rate_limited_until", "is", null);

    if (error) {
      // Migration not run — column doesn't exist, nothing to clear
      if (error.message?.includes("column") || error.code === "42703") {
        return NextResponse.json({
          ok: true,
          message: "No block state to clear (migration not run — all keys already treated as unblocked). Run the schema migration in Supabase to enable persistent block tracking.",
        });
      }
      throw error;
    }

    return NextResponse.json({
      ok: true,
      message: "Rate-limit blocks cleared. Keys will be retried on next API call.",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to reset blocks" },
      { status: 500 }
    );
  }
}
