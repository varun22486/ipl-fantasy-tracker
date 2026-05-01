import { describe, expect, it } from "vitest";
import { refreshPostSchema, seedPostSchema } from "./api-schemas";

describe("seedPostSchema", () => {
  it("accepts trimmed external id", () => {
    const r = seedPostSchema.safeParse({ externalMatchId: "  abc-123  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.externalMatchId).toBe("abc-123");
  });
  it("rejects empty", () => {
    expect(seedPostSchema.safeParse({ externalMatchId: "   " }).success).toBe(false);
  });
});

describe("refreshPostSchema", () => {
  it("accepts empty body", () => {
    const r = refreshPostSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.matchId).toBeUndefined();
  });
  it("accepts numeric matchId", () => {
    const r = refreshPostSchema.safeParse({ matchId: 42 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.matchId).toBe(42);
  });
  it("accepts string matchId digits", () => {
    const r = refreshPostSchema.safeParse({ matchId: "99" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.matchId).toBe(99);
  });
  it("rejects invalid matchId", () => {
    expect(refreshPostSchema.safeParse({ matchId: -1 }).success).toBe(false);
    expect(refreshPostSchema.safeParse({ matchId: "x" }).success).toBe(false);
  });
  it("accepts cricbuzzFallback with matchId", () => {
    const r = refreshPostSchema.safeParse({ matchId: 5, force: true, cricbuzzFallback: true });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.matchId).toBe(5);
      expect(r.data.force).toBe(true);
      expect(r.data.cricbuzzFallback).toBe(true);
    }
  });
  it("accepts cricbuzzOnly with matchId", () => {
    const r = refreshPostSchema.safeParse({ matchId: 12, cricbuzzOnly: true });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.matchId).toBe(12);
      expect(r.data.cricbuzzOnly).toBe(true);
    }
  });
});
