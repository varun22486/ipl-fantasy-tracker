import { describe, expect, it } from "vitest";
import {
  istCalendarDaysBetween,
  isScheduleKeyWithinIstDays,
  LINK_PICKER_DAY_RADIUS,
} from "./next-match";

describe("istCalendarDaysBetween", () => {
  it("returns 1 for next calendar day", () => {
    expect(istCalendarDaysBetween("2026-04-10", "2026-04-11")).toBe(1);
  });

  it("returns -1 for previous calendar day", () => {
    expect(istCalendarDaysBetween("2026-04-11", "2026-04-10")).toBe(-1);
  });

  it("returns 0 for same day", () => {
    expect(istCalendarDaysBetween("2026-04-11", "2026-04-11")).toBe(0);
  });
});

describe("isScheduleKeyWithinIstDays", () => {
  it("accepts yesterday today tomorrow for radius 1", () => {
    const t = "2026-04-11";
    expect(isScheduleKeyWithinIstDays("2026-04-10", t, LINK_PICKER_DAY_RADIUS)).toBe(true);
    expect(isScheduleKeyWithinIstDays("2026-04-11", t, LINK_PICKER_DAY_RADIUS)).toBe(true);
    expect(isScheduleKeyWithinIstDays("2026-04-12", t, LINK_PICKER_DAY_RADIUS)).toBe(true);
  });

  it("rejects two days out", () => {
    const t = "2026-04-11";
    expect(isScheduleKeyWithinIstDays("2026-04-09", t, LINK_PICKER_DAY_RADIUS)).toBe(false);
    expect(isScheduleKeyWithinIstDays("2026-04-13", t, LINK_PICKER_DAY_RADIUS)).toBe(false);
  });
});
