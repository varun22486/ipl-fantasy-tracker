import { describe, expect, it } from "vitest";
import {
  displayRunMilestoneCells,
  fantasyPointsCounted,
  isFantasyBench,
  playerPoints,
  sortFantasyLineupForDisplay,
} from "./scoring";

describe("isFantasyBench", () => {
  it("treats only explicit bench flags as super sub", () => {
    expect(isFantasyBench({ bench: true })).toBe(true);
    expect(isFantasyBench({ bench: false })).toBe(false);
    expect(isFantasyBench({ bench: undefined })).toBe(false);
    expect(isFantasyBench({ bench: "false" as unknown as boolean })).toBe(false);
    expect(isFantasyBench({ bench: "true" })).toBe(true);
  });
});

describe("sortFantasyLineupForDisplay", () => {
  it("puts playing XI before super subs, stable by id", () => {
    const rows = [
      { id: 10, bench: true, name: "sub" },
      { id: 7, bench: false, name: "a" },
      { id: 8, bench: false, name: "b" },
    ];
    expect(sortFantasyLineupForDisplay(rows).map((r) => r.id)).toEqual([7, 8, 10]);
  });
});

describe("playerPoints milestones", () => {
  it("counts only the 100-run tier when both fifty and hundred flags are set", () => {
    const p = {
      side: "You" as const,
      name: "X",
      captain: false,
      runs: 100,
      wickets: 0,
      catches: 0,
      fifty_bonus: 1,
      hundred_bonus: 1,
      three_w_bonus: 0,
      five_w_bonus: 0,
      mom_bonus: 0,
    };
    expect(playerPoints(p).final).toBe(100 + 20);
  });

  it("uses runs >= 100 for century even when hundred_bonus is still 0 in DB", () => {
    const p = {
      side: "You" as const,
      name: "X",
      captain: false,
      runs: 115,
      wickets: 0,
      catches: 0,
      fifty_bonus: 1,
      hundred_bonus: 0,
      three_w_bonus: 0,
      five_w_bonus: 0,
      mom_bonus: 0,
    };
    expect(playerPoints(p).final).toBe(115 + 20);
  });
});

describe("displayRunMilestoneCells", () => {
  it("shows 0 / 1 for 50+ / 100 when runs cross 100 with stale fifty flag", () => {
    expect(
      displayRunMilestoneCells({ runs: 115, fifty_bonus: 1, hundred_bonus: 1 }),
    ).toEqual({ fifty: 0, hundred: 1 });
  });
});

describe("fantasyPointsCounted with coerce", () => {
  it("does not zero points for string false bench", () => {
    const p = {
      side: "You" as const,
      name: "X",
      captain: false,
      bench: "false" as unknown as boolean,
      runs: 10,
      wickets: 0,
      catches: 0,
      fifty_bonus: 0,
      hundred_bonus: 0,
      three_w_bonus: 0,
      five_w_bonus: 0,
      mom_bonus: 0,
    };
    expect(fantasyPointsCounted(p)).toBe(10);
  });
});
