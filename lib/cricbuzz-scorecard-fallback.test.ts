import { describe, expect, it } from "vitest";
import { cricbuzzScorecardApiDataToProviderTree } from "@/lib/cricbuzz-scorecard-fallback";

describe("cricbuzzScorecardApiDataToProviderTree", () => {
  it("sets manOfTheMatch from a dedicated JSON field", () => {
    const tree = cricbuzzScorecardApiDataToProviderTree({
      scoreCard: [],
      playerOfTheMatch: "Yashasvi Jaiswal",
    });
    expect(tree.manOfTheMatch).toBe("Yashasvi Jaiswal");
    expect(tree.scorecard).toEqual([]);
  });

  it("sets manOfTheMatch from nested object with name", () => {
    const tree = cricbuzzScorecardApiDataToProviderTree({
      scoreCard: [],
      mom: { name: "Travis Head", team: "SRH" },
    });
    expect(tree.manOfTheMatch).toBe("Travis Head");
  });

  it("parses MoM from free-text status when keys are absent", () => {
    const tree = cricbuzzScorecardApiDataToProviderTree({
      scoreCard: [],
      matchDesc: "RCB won by 5 wickets. Player of the match: Virat Kohli",
    });
    expect(tree.manOfTheMatch).toBe("Virat Kohli");
  });

  it("still builds scorecard and attaches MoM", () => {
    const tree = cricbuzzScorecardApiDataToProviderTree({
      scoreCard: [
        {
          batTeamDetails: {
            batsmenData: {
              a: { batName: "A Player", runs: "10", outDesc: "not out" },
            },
          },
          bowlTeamDetails: { bowlersData: {} },
        },
      ],
      manOfTheMatch: "A Player",
    });
    expect(tree.manOfTheMatch).toBe("A Player");
    expect(Array.isArray(tree.scorecard)).toBe(true);
    expect((tree.scorecard as unknown[]).length).toBe(1);
  });
});
