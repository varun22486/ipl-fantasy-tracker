import { describe, expect, it } from "vitest";
import { pickTrackedMatchRowFromList, sortTrackedByRecency } from "./active-match";

describe("sortTrackedByRecency", () => {
  it("orders by last_synced_at then id when match_date missing or equal", () => {
    const rows = [
      { id: 16, last_synced_at: "2026-04-10T12:00:00Z" },
      { id: 17, last_synced_at: "2026-04-11T18:00:00Z" },
    ];
    expect(sortTrackedByRecency(rows).map((r) => r.id)).toEqual([17, 16]);
  });

  it("prefers later match_date even when older row has newer last_synced_at", () => {
    const rows = [
      { id: 16, match_date: "2026-04-10", last_synced_at: "2026-04-10T20:33:00Z" },
      { id: 17, match_date: "2026-04-11", last_synced_at: null },
    ];
    expect(sortTrackedByRecency(rows).map((r) => r.id)).toEqual([17, 16]);
  });
});

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

  it("defaults to most recently synced is_current, not only the older LIVE row", () => {
    const rows = [
      { id: 16, is_current: true, status: "LIVE", last_synced_at: "2026-04-10T12:00:00Z", fixture: "M16" },
      { id: 17, is_current: true, status: "COMPLETED", last_synced_at: "2026-04-11T20:00:00Z", fixture: "M17" },
    ];
    const { shownRow, activeTrackedForTabs } = pickTrackedMatchRowFromList(rows, undefined, undefined);
    expect(shownRow?.id).toBe(17);
    expect(activeTrackedForTabs.map((m) => m.id)).toEqual([16]);
  });

  it("defaults to newer fixture when it has no last_synced_at but older row was synced yesterday", () => {
    const rows = [
      {
        id: 16,
        is_current: true,
        match_date: "2026-04-10",
        status: "COMPLETED",
        last_synced_at: "2026-04-10T20:33:00Z",
        fixture: "RR vs RCB",
      },
      {
        id: 17,
        is_current: true,
        match_date: "2026-04-11",
        status: "LIVE",
        last_synced_at: null,
        fixture: "PBKS vs SRH",
      },
    ];
    const { shownRow } = pickTrackedMatchRowFromList(rows, undefined, undefined);
    expect(shownRow?.id).toBe(17);
  });

  it("ignores cookie when that id is no longer is_current", () => {
    const rows = [{ id: 17, is_current: true, status: "COMPLETED", last_synced_at: "2026-04-11T20:00:00Z", fixture: "M17" }];
    const { shownRow } = pickTrackedMatchRowFromList(rows, undefined, "16");
    expect(shownRow?.id).toBe(17);
  });
});
