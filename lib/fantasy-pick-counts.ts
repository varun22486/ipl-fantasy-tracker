import { supabaseAdmin } from "@/lib/supabase-admin";
import { rosterNameKey } from "@/lib/roster-pick-order";

/**
 * Count how many times each player name appears in saved lineups for the competition
 * (all matches, all sides). Keys are {@link rosterNameKey} strings.
 */
export async function fetchFantasyPickCountsByCompetition(
  competitionId: number | null
): Promise<Record<string, number>> {
  let q = supabaseAdmin.from("fantasy_players").select("name");
  if (competitionId != null) {
    q = q.eq("competition_id", competitionId);
  } else {
    q = q.is("competition_id", null);
  }
  const { data, error } = await q;
  if (error || !data?.length) return {};
  const out: Record<string, number> = {};
  for (const row of data as { name: string }[]) {
    const raw = typeof row.name === "string" ? row.name : "";
    const k = rosterNameKey(raw);
    if (!k) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
