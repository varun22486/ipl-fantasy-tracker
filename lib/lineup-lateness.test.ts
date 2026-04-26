import { describe, expect, it } from "vitest";
import { lateParticipantsList, lineupLatenessSideAdjustment } from "./lineup-lateness";

describe("lateParticipantsList", () => {
  it("prefers lineup_late_participants over legacy single", () => {
    expect(
      lateParticipantsList({
        lineup_late_participant: "A",
        lineup_late_participants: ["B", "C"],
      })
    ).toEqual(["B", "C"]);
  });

  it("falls back to legacy when array empty", () => {
    expect(
      lateParticipantsList({
        lineup_late_participant: "Z",
        lineup_late_participants: null,
      })
    ).toEqual(["Z"]);
  });

  it("dedupes", () => {
    expect(
      lateParticipantsList({
        lineup_late_participants: ["a", "A ", "b"],
        lineup_late_participant: "x",
      })
    ).toEqual(["a", "b"]);
  });
});

describe("lineupLatenessSideAdjustment (multi-late)", () => {
  const m = {
    lineup_lateness_enabled: true,
    lineup_late_participants: ["A", "B"],
    lineup_lateness_points: 250,
  };
  const voided = { voided: false, allParticipantNames: ["A", "B", "C"] };

  it("gives late people no bonus (not a negative)", () => {
    expect(lineupLatenessSideAdjustment(m, "A", voided)).toBe(0);
    expect(lineupLatenessSideAdjustment(m, "B", voided)).toBe(0);
  });

  it("gives on-time +P each", () => {
    expect(lineupLatenessSideAdjustment(m, "C", voided)).toBe(250);
  });
});
