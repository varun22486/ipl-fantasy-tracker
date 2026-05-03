import { describe, expect, it } from "vitest";
import { rosterNameKey, sortRosterByPickCountThenName } from "@/lib/roster-pick-order";

describe("sortRosterByPickCountThenName", () => {
  it("orders by pick count descending, then name", () => {
    const counts: Record<string, number> = {
      [rosterNameKey("Virat Kohli")]: 5,
      [rosterNameKey("Anuj Rawat")]: 1,
      [rosterNameKey("Faf du Plessis")]: 3,
    };
    const out = sortRosterByPickCountThenName(["Anuj Rawat", "Faf du Plessis", "Virat Kohli"], counts);
    expect(out[0]).toBe("Virat Kohli");
    expect(out[1]).toBe("Faf du Plessis");
    expect(out[2]).toBe("Anuj Rawat");
  });

  it("falls back to first-name order when pickCounts empty", () => {
    const out = sortRosterByPickCountThenName(["Zak Crawley", "Aaron Finch"], {});
    expect(out[0]).toBe("Aaron Finch");
    expect(out[1]).toBe("Zak Crawley");
  });
});
