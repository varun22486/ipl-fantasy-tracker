import { describe, expect, it } from "vitest";
import {
  emptyFixtureListCopy,
  emptyFixtureListPlainMessage,
  fixturePickerPlainMessage,
  parseMatchesTodayResponse,
  shouldDebitFixtureListCredits,
} from "./fixture-list-client";

describe("parseMatchesTodayResponse", () => {
  it("returns error when ok is false", () => {
    const r = parseMatchesTodayResponse({ ok: false, error: "boom" });
    expect(r).toEqual({ kind: "error", message: "boom" });
  });

  it("returns empty when choices missing or empty", () => {
    expect(parseMatchesTodayResponse({ ok: true, source: "cache", choices: [] }).kind).toBe("empty");
    expect(parseMatchesTodayResponse({ ok: true, source: "api", totalRaw: 3, nonIplSample: ["A"] }).kind).toBe("empty");
  });

  it("returns auto_link for single choice", () => {
    const r = parseMatchesTodayResponse({
      ok: true,
      source: "api",
      date: "Sat",
      choices: [{ fixture: "x", status: "s", match_date: "d", externalMatchId: "id1" }],
    });
    expect(r).toEqual({
      kind: "auto_link",
      externalMatchId: "id1",
      source: "api",
      date: "Sat",
    });
  });

  it("returns picker for multiple choices preserving order", () => {
    const choices = [
      { fixture: "a", status: "s", match_date: "1", externalMatchId: "1" },
      { fixture: "b", status: "s", match_date: "2", externalMatchId: "2" },
    ];
    const r = parseMatchesTodayResponse({ ok: true, source: "cache", date: "D", choices });
    expect(r.kind).toBe("picker");
    if (r.kind === "picker") {
      expect(r.choices).toEqual(choices);
      expect(r.source).toBe("cache");
    }
  });

  it("treats non-cache source as api", () => {
    const r = parseMatchesTodayResponse({
      ok: true,
      choices: [{ fixture: "x", status: "s", match_date: "d" }],
    });
    expect(r.kind).toBe("auto_link");
    if (r.kind === "auto_link") expect(r.source).toBe("api");
  });
});

describe("shouldDebitFixtureListCredits", () => {
  it("only api debits", () => {
    expect(shouldDebitFixtureListCredits("api")).toBe(true);
    expect(shouldDebitFixtureListCredits("cache")).toBe(false);
    expect(shouldDebitFixtureListCredits(undefined)).toBe(false);
  });
});

describe("copy helpers", () => {
  it("emptyFixtureListCopy handles zero totalRaw", () => {
    const { title } = emptyFixtureListCopy(0);
    expect(title).toContain("No matches");
  });

  it("emptyFixtureListPlainMessage appends sample when present", () => {
    const s = emptyFixtureListPlainMessage(2, ["Foo v Bar"]);
    expect(s).toContain("Current feed sample: Foo v Bar");
  });

  it("fixturePickerPlainMessage joins title and detail", () => {
    expect(fixturePickerPlainMessage(3, "cache")).toContain("3 IPL fixtures found");
  });
});
