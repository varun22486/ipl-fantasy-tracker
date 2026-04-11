/** Normalized squad list from `matches.provider_squad_json`. */

export type SquadTeam = { teamName: string; players: string[] };

/**
 * Returns roster data from a stored JSON blob if it looks usable (non-empty rosterNames).
 * Used to skip CricAPI `match_squad` calls when we already have a roster in the DB.
 */
export function parseStoredProviderSquad(raw: unknown): {
  squads: SquadTeam[];
  rosterNames: string[];
  nameToId: Record<string, string>;
} | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const rosterNames = Array.isArray(o.rosterNames)
    ? o.rosterNames.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  if (rosterNames.length === 0) return null;

  const squadsRaw = Array.isArray(o.squads) ? o.squads : [];
  const squads: SquadTeam[] = [];
  for (const item of squadsRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const teamName = typeof rec.teamName === "string" ? rec.teamName : "";
    const players = Array.isArray(rec.players)
      ? rec.players.filter((p): p is string => typeof p === "string")
      : [];
    if (!teamName.trim() && players.length === 0) continue;
    squads.push({ teamName: teamName.trim() ? teamName : "Team", players });
  }

  const nameToId: Record<string, string> = {};
  if (o.nameToId && typeof o.nameToId === "object" && !Array.isArray(o.nameToId)) {
    for (const [k, v] of Object.entries(o.nameToId as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) nameToId[k] = v;
    }
  }

  return { squads, rosterNames, nameToId };
}
