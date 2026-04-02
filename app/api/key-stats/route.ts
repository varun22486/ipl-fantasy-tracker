import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const KEY_LIMIT = 100; // Default daily cap; `hits` in DB is synced from Cricket Data `info.hitsToday`

/** Same buffer as lib/cricket-provider: do not treat key as usable until this long after stored unblock. */
const RATE_LIMIT_BUFFER_MS = 90_000;

export async function GET() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabaseAdmin
      .from("api_key_stats")
      .select("key_alias, hits, last_used_at, rate_limited_until, quota_exhausted_at")
      .eq("stat_date", today)
      .order("key_alias");

    if (error) throw error;

    const keyCount = [
      process.env.CRICKET_API_KEY,
      process.env.CRICKET_API_KEY_2,
      process.env.CRICKET_API_KEY_3,
      process.env.CRICKET_API_KEY_4,
      process.env.CRICKET_API_KEY_5,
      process.env.CRICKET_API_KEY_6,
      process.env.CRICKET_API_KEY_7,
      process.env.CRICKET_API_KEY_8,
      process.env.CRICKET_API_KEY_9,
      process.env.CRICKET_API_KEY_10,
    ].filter(Boolean).length;

    const nowMs = Date.now();
    const stats = (data ?? []).map((row) => {
      const hits = (row.hits as number) ?? 0;
      const rateLimitedUntil = row.rate_limited_until ? new Date(row.rate_limited_until as string) : null;
      const rateLimited = !!(rateLimitedUntil && rateLimitedUntil.getTime() + RATE_LIMIT_BUFFER_MS > nowMs);
      const quotaFlag = (row.quota_exhausted_at as string | null) === today;
      const hitQuotaExhausted = hits >= KEY_LIMIT;
      const quotaExhausted = quotaFlag || hitQuotaExhausted;
      const blocked = quotaExhausted || rateLimited;
      const blockReason = blocked ? (quotaExhausted ? "quota_exhausted" : "rate_limited") : null;
      const resumeAtMs =
        rateLimited && rateLimitedUntil ? rateLimitedUntil.getTime() + RATE_LIMIT_BUFFER_MS : null;
      const resumesInMin =
        resumeAtMs != null ? Math.max(0, Math.ceil((resumeAtMs - nowMs) / 60000)) : null;
      return {
        alias: row.key_alias,
        hits,
        remaining: Math.max(0, KEY_LIMIT - hits),
        last_used_at: row.last_used_at,
        blocked,
        blockReason,
        resumesInMin,
        resume_after_utc: resumeAtMs != null ? new Date(resumeAtMs).toISOString() : null,
        staleQuotaFlag: quotaFlag && !hitQuotaExhausted,
        rate_limited_until: row.rate_limited_until ?? null,
        quota_exhausted_at: row.quota_exhausted_at ?? null,
      };
    });

    const totalHits = stats.reduce((s, r) => s + r.hits, 0);
    const totalRemaining = keyCount * KEY_LIMIT - totalHits;
    const availableKeys = keyCount - stats.filter((s) => s.blocked).length;

    return NextResponse.json({
      ok: true,
      date: today,
      keyCount,
      keyLimit: KEY_LIMIT,
      availableKeys,
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
