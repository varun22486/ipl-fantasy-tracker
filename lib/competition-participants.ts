/**
 * Single source for fantasy `side` labels and competition scoping.
 * Save (lineup API) and load (select / match / history) must use the same rules.
 */

export type CompetitionRow = {
  players?: unknown;
  player1_name?: string | null;
  player2_name?: string | null;
};

function stringFromPlayersJsonEntry(x: unknown): string {
  if (typeof x === "string" || typeof x === "number") return String(x).trim();
  if (x && typeof x === "object" && "name" in (x as object)) {
    const n = (x as { name?: unknown }).name;
    if (typeof n === "string" || typeof n === "number") return String(n).trim();
  }
  const s = String(x ?? "").trim();
  if (s && s !== "[object Object]") return s;
  return "";
}

export function competitionParticipantList(comp: CompetitionRow | null | undefined): string[] {
  if (!comp) return [];
  if (Array.isArray(comp.players)) {
    const list = (comp.players as unknown[]).map(stringFromPlayersJsonEntry).filter(Boolean);
    if (list.length > 0) return list;
  }
  const a = String(comp.player1_name ?? "").trim() || "Player 1";
  const b = String(comp.player2_name ?? "").trim() || "Player 2";
  return [a, b];
}

/** H2H lineup save: side1 = first participant, side2 = second (matches UI labels). */
export function competitionH2hSides(comp: CompetitionRow | null | undefined): { side1: string; side2: string } {
  const list = competitionParticipantList(comp);
  return {
    side1: list[0] ?? "Player 1",
    side2: list[1] ?? "Player 2",
  };
}

export function fantasySideEquals(rowSide: unknown, label: unknown): boolean {
  return String(rowSide ?? "").trim() === String(label ?? "").trim();
}

export function fantasyRowMatchesCompetition(rowCompetitionId: unknown, activeCompetitionId: number | null): boolean {
  if (activeCompetitionId == null) {
    return rowCompetitionId == null || rowCompetitionId === "";
  }
  const r = rowCompetitionId == null || rowCompetitionId === "" ? NaN : Number(rowCompetitionId);
  if (!Number.isFinite(r)) return false;
  return r === Number(activeCompetitionId);
}
