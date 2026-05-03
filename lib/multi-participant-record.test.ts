import { describe, expect, it } from "vitest";
import { buildMultiParticipantSeasonRows, outcomeForMultiParticipantMatch } from "@/lib/multi-participant-record";

const ABC = ["A", "B", "C"] as string[];

describe("outcomeForMultiParticipantMatch", () => {
  it("returns win for sole leader", () => {
    const m = { hasData: true, pts: { A: 100, B: 90, C: 80 } };
    expect(outcomeForMultiParticipantMatch(m, "A", ABC)).toBe("win");
    expect(outcomeForMultiParticipantMatch(m, "B", ABC)).toBe("loss");
    expect(outcomeForMultiParticipantMatch(m, "C", ABC)).toBe("loss");
  });

  it("returns tie for co-leaders", () => {
    const m = { hasData: true, pts: { A: 100, B: 100, C: 80 } };
    expect(outcomeForMultiParticipantMatch(m, "A", ABC)).toBe("tie");
    expect(outcomeForMultiParticipantMatch(m, "B", ABC)).toBe("tie");
    expect(outcomeForMultiParticipantMatch(m, "C", ABC)).toBe("loss");
  });

  it("returns tie for three-way tie at top", () => {
    const m = { hasData: true, pts: { A: 50, B: 50, C: 50 } };
    expect(outcomeForMultiParticipantMatch(m, "A", ABC)).toBe("tie");
    expect(outcomeForMultiParticipantMatch(m, "B", ABC)).toBe("tie");
    expect(outcomeForMultiParticipantMatch(m, "C", ABC)).toBe("tie");
  });
});

describe("buildMultiParticipantSeasonRows", () => {
  it("keeps wins + losses + ties equal to matches per player", () => {
    const stats = [
      { hasData: true, pts: { A: 10, B: 5, C: 5 } },
      { hasData: true, pts: { A: 7, B: 7, C: 6 } },
      { hasData: true, pts: { A: 1, B: 2, C: 3 } },
    ];
    const rows = buildMultiParticipantSeasonRows(stats, ABC);
    for (const r of rows) {
      expect(r.wins + r.losses + r.ties).toBe(r.matches);
    }
    expect(rows.find((r) => r.name === "A")!.wins).toBe(1);
    expect(rows.find((r) => r.name === "A")!.ties).toBe(1);
    expect(rows.find((r) => r.name === "A")!.losses).toBe(1);
  });
});
