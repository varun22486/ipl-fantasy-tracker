import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * External CricAPI match ids for fixtures this fantasy league already has
 * at least one `fantasy_players` row for (same competition scope as lineup saves).
 */
export async function getExternalMatchIdsPlayedInFantasy(competitionId: number | null): Promise<Set<string>> {
  let q = supabaseAdmin.from("fantasy_players").select("match_id");
  if (competitionId == null) {
    q = q.is("competition_id", null);
  } else {
    q = q.eq("competition_id", competitionId);
  }
  const { data: fps, error } = await q;
  if (error || !fps?.length) return new Set();

  const matchIds = [...new Set(fps.map((r: { match_id: number }) => r.match_id).filter((id) => id != null && id > 0))];
  if (matchIds.length === 0) return new Set();

  const { data: ms } = await supabaseAdmin
    .from("matches")
    .select("external_match_id")
    .in("id", matchIds)
    .not("external_match_id", "is", null);

  const out = new Set<string>();
  for (const m of ms ?? []) {
    const ext = typeof m.external_match_id === "string" ? m.external_match_id.trim() : "";
    if (ext) out.add(ext);
  }
  return out;
}
