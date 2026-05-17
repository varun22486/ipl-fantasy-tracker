import { describe, expect, it } from "vitest";
import {
  pickTrackedMatchRowFromList,
  pickTrackedMatchRowWithLineupPreference,
  sameNumericId,
  sortTrackedByRecency,
} from "./active-match";

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

describe("sameNumericId", () => {
  it("treats string and number ids as equal", () => {
    expect(sameNumericId("60", 60)).toBe(true);
    expect(sameNumericId(60, 60)).toBe(true);
  });
});

describe("pickTrackedMatchRowFromList", () => {
  it("uses ?m= when row id is a string from Supabase", () => {
    const rows = [
      { id: "60" as unknown as number, is_current: true, fixture: "PBKS vs RCB, Match 61", status: "SCHEDULED" },
      { id: "61" as unknown as number, is_current: true, fixture: "Other", status: "LIVE", last_synced_at: "2026-05-17T12:00:00Z" },
    ];
    const { shownRow } = pickTrackedMatchRowFromList(rows, "60");
    expect(shownRow?.id).toBe("60");
  });

  it("uses ?m= id even when that match is not is_current / not in live tabs", () => {
    const rows = [
      { id: 17, is_current: false, match_date: "2026-04-11", fixture: "PBKS vs SRH, Match 17", status: "COMPLETED" },
      { id: 16, is_current: true, match_date: "2026-04-10", fixture: "RR vs RCB, Match 16", status: "LIVE" },
    ];
    const { shownRow, activeTrackedForTabs, activeTabsScope } = pickTrackedMatchRowFromList(rows, "17", {
      todayIstIso: "2026-04-11",
    });
    expect(shownRow?.id).toBe(17);
    expect(activeTrackedForTabs.map((m) => m.id)).toEqual([16]);
    expect(activeTabsScope).toBe("live");
  });

  it("defaults to most recently synced is_current, not only the older LIVE row", () => {
    const rows = [
      { id: 16, is_current: true, status: "LIVE", last_synced_at: "2026-04-10T12:00:00Z", fixture: "M16" },
      { id: 17, is_current: true, status: "COMPLETED", last_synced_at: "2026-04-11T20:00:00Z", fixture: "M17" },
    ];
    const { shownRow, activeTrackedForTabs, activeTabsScope } = pickTrackedMatchRowFromList(rows, undefined, {
      todayIstIso: "2026-04-11",
    });
    expect(shownRow?.id).toBe(17);
    expect(activeTrackedForTabs.map((m) => m.id)).toEqual([16]);
    expect(activeTabsScope).toBe("live");
  });

  it("shows tabs for two SCHEDULED is_current fixtures on the same IST day (double-header)", () => {
    const rows = [
      {
        id: 101,
        is_current: true,
        match_date: "2026-04-12",
        fixture: "LSG vs GT, Match 19, Indian Premier League 2026",
        status: "SCHEDULED",
        last_synced_at: null,
      },
      {
        id: 102,
        is_current: true,
        match_date: "2026-04-12",
        fixture: "MI vs RCB, Match 20, Indian Premier League 2026",
        status: "SCHEDULED",
        last_synced_at: null,
      },
    ];
    const { shownRow, activeTrackedForTabs, activeTabsScope } = pickTrackedMatchRowFromList(rows, undefined, {
      todayIstIso: "2026-04-12",
    });
    expect(activeTabsScope).toBe("today");
    expect(activeTrackedForTabs.map((m) => m.id).sort((a, b) => a - b)).toEqual([101, 102]);
    expect(shownRow?.id).toBe(102);
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
    const { shownRow } = pickTrackedMatchRowFromList(rows, undefined, { todayIstIso: "2026-04-11" });
    expect(shownRow?.id).toBe(17);
  });

  it("ignores cookie when that id is no longer is_current", () => {
    const rows = [{ id: 17, is_current: true, status: "COMPLETED", last_synced_at: "2026-04-11T20:00:00Z", fixture: "M17" }];
    const { shownRow } = pickTrackedMatchRowFromList(rows, undefined, { todayIstIso: "2026-04-11" });
    expect(shownRow?.id).toBe(17);
  });

  it("uses newest tracked fixture when several are is_current (no stale cookie preference)", () => {
    const rows = [
      { id: 16, is_current: true, match_date: "2026-04-10", status: "COMPLETED", fixture: "M16" },
      { id: 17, is_current: true, match_date: "2026-04-11", status: "LIVE", fixture: "PBKS vs SRH" },
    ];
    const { shownRow } = pickTrackedMatchRowFromList(rows, undefined, { todayIstIso: "2026-04-11" });
    expect(shownRow?.id).toBe(17);
  });
});

describe("pickTrackedMatchRowWithLineupPreference", () => {
  it("prefers tracked row with saved lineups over newer duplicate fixture row", () => {
    const fixture = "PBKS vs RCB, Match 61, Indian Premier League 2026";
    const rows = [
      {
        id: 60,
        is_current: true,
        match_date: "2026-05-17",
        fixture,
        status: "SCHEDULED",
        last_synced_at: null,
      },
      {
        id: 61,
        is_current: true,
        match_date: "2026-05-17",
        fixture,
        status: "SCHEDULED",
        last_synced_at: "2026-05-17T12:00:00Z",
      },
    ];
    const { shownRow } = pickTrackedMatchRowWithLineupPreference(rows, undefined, new Set([60]), {
      todayIstIso: "2026-05-17",
    });
    expect(shownRow?.id).toBe(60);
  });

  it("still honors explicit ?m= when set", () => {
    const rows = [
      { id: 60, is_current: true, fixture: "A", status: "SCHEDULED" },
      { id: 61, is_current: true, fixture: "B", status: "SCHEDULED" },
    ];
    const { shownRow } = pickTrackedMatchRowWithLineupPreference(rows, "61", new Set([60]));
    expect(shownRow?.id).toBe(61);
  });

  it("matches lineups by IPL league match number when fixture text differs", () => {
    const rows = [
      {
        id: 60,
        is_current: false,
        match_date: "2026-05-17",
        fixture: "PBKS vs RCB, Match 61",
        status: "SCHEDULED",
      },
      {
        id: 61,
        is_current: true,
        match_date: "2026-05-17",
        fixture: "Punjab Kings vs Royal Challengers Bengaluru, 61st Match, Indian Premier League 2026",
        status: "SCHEDULED",
        last_synced_at: "2026-05-17T12:00:00Z",
      },
    ];
    const { shownRow } = pickTrackedMatchRowWithLineupPreference(rows, undefined, new Set([60]), {
      todayIstIso: "2026-05-17",
    });
    expect(shownRow?.id).toBe(60);
  });
});
