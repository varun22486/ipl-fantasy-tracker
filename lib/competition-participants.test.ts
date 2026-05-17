import { describe, expect, it } from "vitest";
import {
  competitionH2hSides,
  competitionParticipantList,
  fantasyRowMatchesCompetition,
  fantasySideEquals,
} from "./competition-participants";

describe("competitionParticipantList", () => {
  it("prefers players json over player1/player2 columns", () => {
    expect(
      competitionParticipantList({
        players: ["Rahul", "Satya"],
        player1_name: "Legacy1",
        player2_name: "Legacy2",
      }),
    ).toEqual(["Rahul", "Satya"]);
  });
});

describe("competitionH2hSides", () => {
  it("uses players array order for save sides", () => {
    expect(
      competitionH2hSides({
        players: ["Rahul", "Satya"],
        player1_name: "Legacy1",
        player2_name: "Legacy2",
      }),
    ).toEqual({ side1: "Rahul", side2: "Satya" });
  });
});

describe("fantasySideEquals", () => {
  it("trims whitespace", () => {
    expect(fantasySideEquals("  Rahul  ", "Rahul")).toBe(true);
  });
});

describe("fantasyRowMatchesCompetition", () => {
  it("matches string and number competition ids", () => {
    expect(fantasyRowMatchesCompetition("4", 4)).toBe(true);
  });
});
