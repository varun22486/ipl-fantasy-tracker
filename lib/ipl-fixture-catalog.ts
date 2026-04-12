import { supabaseAdmin } from "@/lib/supabase-admin";
import type { MatchSeed } from "@/lib/cricket-provider";
import { effectiveScheduleDateKeyForMatch, iplCalendarTodayIso } from "@/lib/next-match";

/** Same calendar window as the feed list — keep list from growing unbounded. */
const CATALOG_WINDOW_DAYS = 14;

export async function upsertMatchSeedCatalog(seed: MatchSeed): Promise<void> {
  const ext = typeof seed.externalMatchId === "string" ? seed.externalMatchId.trim() : "";
  if (!ext) return;
  const { error } = await supabaseAdmin.from("ipl_fixture_catalog").upsert(
    {
      external_match_id: ext,
      payload: seed as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "external_match_id" }
  );
  if (error) console.error("[ipl_fixture_catalog] upsert failed:", error.message);
}

export async function upsertMatchSeedCatalogMany(seeds: MatchSeed[]): Promise<void> {
  const rows = seeds
    .filter((s) => typeof s.externalMatchId === "string" && s.externalMatchId.trim())
    .map((s) => ({
      external_match_id: s.externalMatchId!.trim(),
      payload: s as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    }));
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin.from("ipl_fixture_catalog").upsert(rows, { onConflict: "external_match_id" });
  if (error) console.error("[ipl_fixture_catalog] batch upsert failed:", error.message);
}

export async function loadMatchSeedFromCatalog(externalMatchId: string): Promise<MatchSeed | null> {
  try {
    const id = externalMatchId.trim();
    if (!id) return null;
    const { data, error } = await supabaseAdmin.from("ipl_fixture_catalog").select("payload").eq("external_match_id", id).maybeSingle();
    if (error || !data?.payload || typeof data.payload !== "object") return null;
    return data.payload as MatchSeed;
  } catch {
    return null;
  }
}

export function isMatchSeedInDisplayWindow(seed: MatchSeed, todayIso: string): boolean {
  const key = effectiveScheduleDateKeyForMatch({
    id: 0,
    match_date: seed.match_date,
    fixture: seed.fixture,
  });
  if (!key) return true;
  const dayMs = 86_400_000;
  const t0 = Date.parse(`${todayIso}T12:00:00.000Z`);
  const t1 = Date.parse(`${key}T12:00:00.000Z`);
  if (Number.isNaN(t0) || Number.isNaN(t1)) return true;
  return Math.abs(t1 - t0) / dayMs <= CATALOG_WINDOW_DAYS;
}

export async function loadMatchSeedsFromCatalogForWindow(): Promise<MatchSeed[]> {
  try {
    const todayIso = iplCalendarTodayIso();
    const { data, error } = await supabaseAdmin
      .from("ipl_fixture_catalog")
      .select("payload")
      .order("updated_at", { ascending: false });
    if (error || !data?.length) return [];
    const out: MatchSeed[] = [];
    for (const row of data) {
      const seed = row.payload as MatchSeed;
      if (!seed?.externalMatchId) continue;
      if (isMatchSeedInDisplayWindow(seed, todayIso)) out.push(seed);
    }
    return out;
  } catch {
    return [];
  }
}
