import { describe, expect, it } from "vitest";
import { pickTrackedMatchRowFromList } from "./active-match";

describe("pickTrackedMatchRowFromList", () => {
  it("uses ?m= id even when that match is not is_current / not in live tabs", () => {
    const rows = [
      { id: 17, is_current: false, match_date: "2026-04-11", fixture: "PBKS vs SRH, Match 17", status: "COMPLETED" },
      { id: 16, is_current: true, match_date: "2026-04-10", fixture: "RR vs RCB, Match 16", status: "LIVE" },
    ];
    const { shownRow, activeTrackedForTabs } = pickTrackedMatchRowFromList(rows, "17", undefined);
    expect(shownRow?.id).toBe(17);
    expect(activeTrackedForTabs.map((m) => m.id)).toEqual([16]);
  });
});
