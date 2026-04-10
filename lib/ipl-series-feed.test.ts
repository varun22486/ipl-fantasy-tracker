import { describe, expect, it } from "vitest";
import {
  extractProviderMatchDate,
  formatDateInTimeZone,
  IPL_TZ,
  isLikelyInPlayFromProviderStatus,
  pickIplSeriesMatchesForFeedWindow,
} from "./ipl-series-feed";

describe("extractProviderMatchDate", () => {
  it("reads ISO date prefix from date field", () => {
    expect(extractProviderMatchDate({ date: "2026-04-06T14:30:00.000Z" })).toBe("2026-04-06");
  });

  it("converts ms epoch to IST calendar day", () => {
    const ms = Date.parse("2026-04-05T20:00:00.000Z");
    expect(extractProviderMatchDate({ ms })).toBe(formatDateInTimeZone(new Date(ms), IPL_TZ));
  });

  it("reads unix seconds startTime", () => {
    const sec = Math.floor(Date.parse("2026-04-06T10:00:00.000Z") / 1000);
    expect(extractProviderMatchDate({ startTime: sec })).toBe(
      formatDateInTimeZone(new Date(sec * 1000), IPL_TZ)
    );
  });

  it("reads nested matchInfo.dateTimeGMT", () => {
    expect(
      extractProviderMatchDate({
        matchInfo: { dateTimeGMT: "2026-04-06T14:30:00.000Z" },
      })
    ).toBe("2026-04-06");
  });

  it("reads seriesAdWrapper.matchInfo", () => {
    expect(
      extractProviderMatchDate({
        seriesAdWrapper: { matchInfo: { dateTimeGMT: "2026-04-07T18:00:00.000Z" } },
      })
    ).toBe("2026-04-07");
  });
});

describe("isLikelyInPlayFromProviderStatus", () => {
  it("detects live and toss / innings wording", () => {
    expect(isLikelyInPlayFromProviderStatus({ status: "Live: RR 120/3" })).toBe(true);
    expect(isLikelyInPlayFromProviderStatus({ overview: "Rajasthan Royals won the toss" })).toBe(true);
    expect(isLikelyInPlayFromProviderStatus({ status: "Scheduled: Apr 6" })).toBe(false);
  });
});

describe("pickIplSeriesMatchesForFeedWindow", () => {
  const nowMs = Date.parse("2026-04-06T08:00:00.000Z");

  it("includes fixtures whose IST date falls in the window", () => {
    const rows = [
      { id: "a", date: "2026-04-05", name: "Older" },
      { id: "b", date: "2026-04-06", name: "RR vs RCB" },
      { id: "c", date: "2026-04-20", name: "Future" },
    ];
    const picked = pickIplSeriesMatchesForFeedWindow(rows, nowMs, { windowHalfWidthDays: 3 });
    const ids = picked.map((m) => m.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("keeps an in-play row even when schedule fields are missing (not in date window)", () => {
    const filler = Array.from({ length: 15 }, (_, i) => ({
      id: `past-${i}`,
      date: `2026-03-${String(28 - Math.min(i, 10)).padStart(2, "0")}`,
      name: `Match ${i}`,
    }));
    const liveNoSchedule = {
      id: "rr-rcb-live",
      status: "Live: RR 45/0 (5 ovs)",
      name: "RR vs RCB, 16th Match",
    };
    const rows = [...filler, liveNoSchedule];
    const picked = pickIplSeriesMatchesForFeedWindow(rows, nowMs);
    expect(picked.some((m) => m.id === "rr-rcb-live")).toBe(true);
  });

  it("falls back to list tail when no dates and no live heuristics match", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `x-${i}`,
      name: `Team A vs B ${i}`,
    }));
    const picked = pickIplSeriesMatchesForFeedWindow(rows, nowMs, { tailIfNoDates: 5 });
    expect(picked).toHaveLength(5);
    expect(picked[0].id).toBe("x-20");
  });
});
