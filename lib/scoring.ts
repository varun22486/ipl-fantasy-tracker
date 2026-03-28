export type FantasyPlayer = {
  id?: number;
  side: "You" | "Rahul";
  name: string;
  trump: boolean;
  runs: number;
  wickets: number;
  catches: number;
  fifty_bonus: number;
  hundred_bonus: number;
  three_w_bonus: number;
  five_w_bonus: number;
  mom_bonus: number;
};

export const scoring = {
  run: 1,
  wicket: 20,
  catch: 10,
  fifty: 10,
  hundred: 20,
  threeW: 10,
  fiveW: 20,
  mom: 10,
};

export function playerPoints(p: FantasyPlayer) {
  const base =
    p.runs * scoring.run +
    p.wickets * scoring.wicket +
    p.catches * scoring.catch +
    p.fifty_bonus * scoring.fifty +
    p.hundred_bonus * scoring.hundred +
    p.three_w_bonus * scoring.threeW +
    p.five_w_bonus * scoring.fiveW +
    p.mom_bonus * scoring.mom;

  return {
    base,
    final: p.trump ? base * 2 : base,
  };
}

export function teamPoints(players: FantasyPlayer[]) {
  return players.reduce((sum, p) => sum + playerPoints(p).final, 0);
}
