import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseLeagueMatchNumberFromFixture } from "@/lib/format";
import type { FantasyPlayer } from "@/lib/scoring";
import { sameNumericId } from "@/lib/active-match";
import {
  fantasyRowMatchesCompetition,
  fantasySideEquals,
  fantasySideMatchesParticipant,
  type CompetitionRow,
} from "@/lib/competition-participants";

/** Distinct match ids that have at least one fantasy row for this competition scope. */
export async function fetchMatchIdsWithLineups(competitionId: number | null): Promise<Set<number>> {
  let q = supabaseAdmin.from("fantasy_players").select("match_id");
  if (competitionId != null) {
    q = q.eq("competition_id", competitionId);
  } else {
    q = q.is("competition_id", null);
  }
  const { data } = await q;
  const ids = new Set<number>();
  for (const row of data ?? []) {
    const n = Number((row as { match_id: unknown }).match_id);
    if (Number.isFinite(n)) ids.add(n);
  }
  if (competitionId != null && ids.size === 0) {
    const { data: legacy } = await supabaseAdmin.from("fantasy_players").select("match_id").is("competition_id", null);
    for (const row of legacy ?? []) {
      const n = Number((row as { match_id: unknown }).match_id);
      if (Number.isFinite(n)) ids.add(n);
    }
  }
  return ids;
}

/** Same query path as `/match/[id]` — per-match rows, not the full fantasy_players table. */
export async function fetchPlayersForMatch(
  matchId: number,
  competitionId: number | null
): Promise<FantasyPlayer[]> {
  if (!Number.isFinite(matchId) || matchId <= 0) return [];

  const base = () =>
    supabaseAdmin.from("fantasy_players").select("*").eq("match_id", matchId).order("id", { ascending: true });

  if (competitionId != null) {
    const { data } = await base().eq("competition_id", competitionId);
    if ((data?.length ?? 0) > 0) return (data ?? []) as FantasyPlayer[];
    const { data: legacy } = await base().is("competition_id", null);
    return (legacy ?? []) as FantasyPlayer[];
  }

  const { data } = await base().is("competition_id", null);
  return (data ?? []) as FantasyPlayer[];
}

export function splitH2hLineup(
  rows: FantasyPlayer[],
  yourName: string,
  opponentName: string,
  competitionId: number | null,
  comp: CompetitionRow | null
): { your: FantasyPlayer[]; opp: FantasyPlayer[] } {
  const scoped = rows.filter((p) =>
    fantasyRowMatchesCompetition(
      (p as FantasyPlayer & { competition_id?: number | null }).competition_id,
      competitionId
    )
  );

  const sideMatches = (rowSide: unknown, label: string) =>
    competitionId != null ? fantasySideMatchesParticipant(rowSide, label, comp) : fantasySideEquals(rowSide, label);

  let your = scoped.filter((p) => (competitionId != null ? sideMatches(p.side, yourName) : p.side === "You"));
  let opp = scoped.filter((p) =>
    competitionId != null ? sideMatches(p.side, opponentName) : p.side !== "You"
  );

  if (your.length === 0 && opp.length === 0 && scoped.length > 0) {
    const sides = [...new Set(scoped.map((p) => String(p.side ?? "").trim()).filter(Boolean))];
    if (sides.length >= 1) {
      your = scoped.filter((p) => String(p.side ?? "").trim() === sides[0]);
      opp = sides.length >= 2 ? scoped.filter((p) => String(p.side ?? "").trim() === sides[1]) : [];
    }
  }

  return { your, opp };
}

type MatchRow = { id: unknown; fixture?: string | null };

/** When duplicate DB rows share an IPL league match #, use the row that has lineups. */
export function pickMatchRowWithLineups<T extends MatchRow>(
  list: T[],
  preferred: T | null,
  lineupMatchIds: ReadonlySet<number>
): T | null {
  if (!preferred) return null;
  if (lineupMatchIds.has(Number(preferred.id))) return preferred;

  const leagueN = parseLeagueMatchNumberFromFixture(
    typeof preferred.fixture === "string" ? preferred.fixture : String(preferred.fixture ?? "")
  );
  if (leagueN != null) {
    const sibling = list.find(
      (m) =>
        lineupMatchIds.has(Number(m.id)) &&
        parseLeagueMatchNumberFromFixture(
          typeof m.fixture === "string" ? m.fixture : String(m.fixture ?? "")
        ) === leagueN
    );
    if (sibling) return sibling;
  }

  return preferred;
}

export function parseExplicitMatchId(queryM: string | undefined): number | null {
  const t = queryM?.trim() ?? "";
  if (!/^\d+$/.test(t)) return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function findMatchInList<T extends MatchRow>(list: T[], matchId: number): T | null {
  return list.find((m) => sameNumericId(m.id, matchId)) ?? null;
}
