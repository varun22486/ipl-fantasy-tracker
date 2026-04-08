/**
 * One-off: run DuckDuckGo MoM fallback for listed IPL 2026 fixtures (same as app).
 * Usage: npx tsx scripts/scan-ipl2026-mom.ts
 */
import { searchWebForMomForFixture } from "../lib/web-mom-search";

/** League #, IST date, full fixture prefix (teams only — formatFixture parses vs). */
const IPL_2026_THROUGH_MAR_31: { n: number; date: string; fixture: string }[] = [
  { n: 1, date: "2026-03-28", fixture: "Royal Challengers Bengaluru vs Sunrisers Hyderabad, 1st Match, Indian Premier League 2026" },
  { n: 2, date: "2026-03-29", fixture: "Mumbai Indians vs Kolkata Knight Riders, 2nd Match, Indian Premier League 2026" },
  { n: 3, date: "2026-03-30", fixture: "Rajasthan Royals vs Chennai Super Kings, 3rd Match, Indian Premier League 2026" },
  { n: 4, date: "2026-03-31", fixture: "Punjab Kings vs Gujarat Titans, 4th Match, Indian Premier League 2026" },
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("IPL 2026 MoM scan (DDG fallback, same as production)\n");
  for (const m of IPL_2026_THROUGH_MAR_31) {
    process.stdout.write(`Match ${m.n} (${m.date}) ${m.fixture.slice(0, 56)}…\n  → `);
    const mom = await searchWebForMomForFixture(m.fixture, m.date);
    console.log(mom ?? "(no parseable MoM in top results)");
    await sleep(2500);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
