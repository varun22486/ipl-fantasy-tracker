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

    // Clear both rate_limited_until AND quota_exhausted_at for today.
    // quota_exhausted_at can be stale — CricAPI sometimes returns the quota-exceeded
    // message temporarily even when the key isn't fully spent for the day.
    const { error } = await supabaseAdmin
      .from("api_key_stats")
      .update({ rate_limited_until: null, quota_exhausted_at: null })
      .eq("stat_date", today);

    if (error) {
      // Migration not run — columns don't exist yet
      if (error.message?.includes("column") || error.code === "42703") {
        return NextResponse.json({
          ok: true,
          message: "Nothing to clear — block-tracking columns not yet created. Run the SQL migration in Supabase to enable persistent block tracking.",
        });
      }
      throw error;
    }

    return NextResponse.json({
      ok: true,
      message: "All blocks cleared (rate-limit + quota flags). Keys will be retried fresh on the next API call.",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to reset blocks" },
      { status: 500 }
    );
  }
}
