"use client";

import React, { useState, type CSSProperties } from "react";
import SelectClient from "@/components/SelectClient";
import { FantasyPlayer } from "@/lib/scoring";

type SquadTeam = { teamName: string; players: string[] };

type Props = {
  yourName: string;
  opponentName: string;
  yourPlayers: FantasyPlayer[];
  opponentPlayers: FantasyPlayer[];
  /** Full fantasy_players rows for this match + competition (needed for multi-player existing picks). */
  allPlayers: FantasyPlayer[];
  rosterNames: string[];
  squads: SquadTeam[];
  nameToId: Record<string, string>;
  matchId: number;
  competitionId: number | null;
  isMulti: boolean;
  compPlayers: string[];
};

const btnSecondary: CSSProperties = {
  padding: "8px 16px",
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  background: "white",
  color: "#475569",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

export default function MatchDetailLineupEditor({
  yourName,
  opponentName,
  yourPlayers,
  opponentPlayers,
  allPlayers,
  rosterNames,
  squads,
  nameToId,
  matchId,
  competitionId,
  isMulti,
  compPlayers,
}: Props) {
  const [open, setOpen] = useState(false);

  const rowToPick = (p: FantasyPlayer) => ({
    name: p.name,
    captain: p.captain,
    bench: p.bench,
    provider_player_id: p.provider_player_id ?? null,
  });

  const existingYour = yourPlayers.map(rowToPick);
  const existingOpp = opponentPlayers.map(rowToPick);
  const existingPicks =
    isMulti && compPlayers.length > 0
      ? compPlayers.map((name) => allPlayers.filter((p) => p.side === name).map(rowToPick))
      : undefined;

  if (!open) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-start" }}>
        <button type="button" onClick={() => setOpen(true)} style={btnSecondary}>
          ✏️ Edit lineups
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Change teams for this match</div>
        <button type="button" onClick={() => setOpen(false)} style={btnSecondary}>
          ✕ Close
        </button>
      </div>
      <SelectClient
        yourName={yourName}
        opponentName={opponentName}
        yourPlayers={existingYour}
        opponentPlayers={existingOpp}
        rosterNames={rosterNames}
        squads={squads}
        nameToId={nameToId}
        hasLinkedMatch
        matchId={matchId}
        competitionId={competitionId}
        compPlayers={isMulti ? compPlayers : undefined}
        existingPicks={existingPicks}
        afterLineupSaveHref={`/match/${matchId}${competitionId != null ? `?c=${encodeURIComponent(String(competitionId))}` : ""}`}
      />
    </div>
  );
}
