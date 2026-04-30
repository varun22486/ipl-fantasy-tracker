import { NextRequest, NextResponse } from "next/server";
import { refreshMatchFromProvider, type PlayerStats } from "@/lib/cricket-provider";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { type FantasyPlayer, playerPoints, scoringFromSettings } from "@/lib/scoring";

/** Context around `needle` inside JSON.stringify(tree) — catches odd keys / string blobs. */
function probeJsonSnippets(tree: unknown, needle: string, maxSnippets = 4, window = 320): string[] {
  const want = needle.trim().toLowerCase();
  if (!want || tree == null) return [];
  let s: string;
  try {
    s = JSON.stringify(tree);
  } catch {
    return [];
  }
  const lower = s.toLowerCase();
  const out: string[] = [];
  let pos = 0;
  while (out.length < maxSnippets) {
    const idx = lower.indexOf(want, pos);
    if (idx < 0) break;
    const start = Math.max(0, idx - window);
    const end = Math.min(s.length, idx + needle.trim().length + window);
    out.push(s.slice(start, end));
    pos = idx + want.length;
  }
  return out;
}

const DEBUG_RAW_JSON_CAP = 140_000;

function truncateJsonString(obj: unknown): string | undefined {
  if (obj == null) return undefined;
  try {
    const s = JSON.stringify(obj);
    if (s.length <= DEBUG_RAW_JSON_CAP) return s;
    return `${s.slice(0, DEBUG_RAW_JSON_CAP)}\n… truncated, total ${s.length} chars`;
  } catch {
    return "[unserializable]";
  }
}

/** Walk CricAPI `raw` JSON and collect objects that look like batting/bowling rows for this name. */
function probeRawRowsForPlayer(raw: unknown, needle: string, maxHits = 30): Record<string, unknown>[] {
  const want = needle
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!want) return [];

  function nameBlob(o: Record<string, unknown>): string {
    const bits: string[] = [];
    const add = (v: unknown) => {
      if (typeof v === "string" && v.trim()) bits.push(v);
      if (v && typeof v === "object" && !Array.isArray(v) && typeof (v as Record<string, unknown>).name === "string") {
        bits.push(String((v as Record<string, unknown>).name));
      }
    };
    add(o.name);
    add(o.shortName);
    add(o.playerName);
    add(o.fullName);
    add(o.batName);
    add(o.batsman);
    add(o.bowler);
    add(o.batsmanName);
    add(o.bowlerName);
    add(o.striker);
    add(o.nonStriker);
    add(o.stricker);
    return bits.join(" ").toLowerCase().replace(/\s+/g, " ");
  }

  const tokens = want.split(" ").filter((t) => t.length > 0);
  const hits: Record<string, unknown>[] = [];

  const visit = (v: unknown, depth: number) => {
    if (hits.length >= maxHits || depth > 20) return;
    if (v == null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    const blob = nameBlob(o);
    const matches =
      blob.includes(want) || (tokens.length > 1 && tokens.every((t) => t.length >= 2 && blob.includes(t)));
    if (matches) {
      hits.push({
        batsman: o.batsman,
        bowler: o.bowler,
        name: o.name,
        r: o.r,
        runs: o.runs,
        run: o.run,
        batRuns: o.batRuns,
        batsmanRuns: o.batsmanRuns,
        score: o.score,
        balls: o.b ?? o.balls,
        dismissal: o.dismissal ?? o.out ?? o.dismiss ?? o.wicket,
        w: o.w,
        wickets: o.wickets,
        o: o.o,
        overs: o.overs,
      });
    }
    for (const k of Object.keys(o)) visit(o[k], depth + 1);
  };

  visit(raw, 0);
  return hits;
}

function providerStatsToFantasy(p: PlayerStats): FantasyPlayer {
  return {
    side: "You",
    name: p.name,
    captain: false,
    bench: false,
    runs: p.runs,
    wickets: p.wickets,
    catches: p.catches,
    runouts: p.runouts ?? 0,
    stumpings: p.stumpings ?? 0,
    fifty_bonus: p.fifty_bonus,
    hundred_bonus: p.hundred_bonus,
    three_w_bonus: p.three_w_bonus,
    five_w_bonus: p.five_w_bonus,
    mom_bonus: p.mom_bonus ?? 0,
    provider_player_id: p.id ?? null,
  };
}

/**
 * GET /api/debug-scorecard?id=<cricapi-uuid>
 * Runs the same provider pipeline as Sync scores (no DB writes). Use to see player rows * and metadata returned for a linked fixture.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")?.trim();
  const probe = req.nextUrl.searchParams.get("probe")?.trim() ?? "";
  const wantRawDump = req.nextUrl.searchParams.get("raw") === "1";
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Missing id query param (CricAPI external match UUID)." },
      { status: 400 }
    );
  }

  try {
    const [{ data: settings }, payload] = await Promise.all([
      supabaseAdmin.from("series_settings").select("*").limit(1).maybeSingle(),
      refreshMatchFromProvider(id, {
      includeMergedParseTree: true,
      fixtureFromDb: req.nextUrl.searchParams.get("fixture")?.trim() || undefined,
    }),
    ]);
    const rules = scoringFromSettings(settings as Record<string, unknown> | null);

    const players = payload.players.map((p) => {
      const fp = providerStatsToFantasy(p);
      const asPick = playerPoints(fp, rules);
      const asCaptain = playerPoints({ ...fp, captain: true }, rules);
      return {
        id: p.id ?? null,
        name: p.name,
        runs: p.runs,
        wickets: p.wickets,
        catches: p.catches,
        runouts: p.runouts ?? 0,
        stumpings: p.stumpings ?? 0,
        fifty_bonus: p.fifty_bonus,
        hundred_bonus: p.hundred_bonus,
        three_w_bonus: p.three_w_bonus,
        five_w_bonus: p.five_w_bonus,
        mom_bonus: p.mom_bonus ?? 0,
        /** Points with your series rules (no captain ×2). */
        fantasyPts: asPick.base,
        /** Same stats if this player were your fantasy captain (×2 on base). */
        fantasyPtsAsCaptain: asCaptain.final,
      };
    });

    const probeLower = probe.toLowerCase().trim();
    const parsedForProbe =
      probeLower.length > 1
        ? payload.players.find((p) => {
            const pl = p.name.toLowerCase();
            return pl === probeLower || pl.includes(probeLower) || probeLower.includes(pl);
          })
        : undefined;

    return NextResponse.json({
      ok: true,
      externalMatchId: id,
      /** HTTP path used for the winning scorecard fetch (see lib/cricket-provider candidatePaths). */
      providerFetchPath: payload.providerFetchPath ?? null,
      fixture: payload.fixture ?? null,
      status: payload.status ?? null,
      match_date: payload.match_date ?? null,
      live_summary: payload.live_summary ?? null,
      venue: payload.venue ?? null,
      toss_winner: payload.toss_winner ?? null,
      scoringRules: rules,
      playerCount: players.length,
      players,
      rosterNameCount: payload.rosterNames.length,
      rosterSample: payload.rosterNames.slice(0, 24),
      squadTeamCount: payload.squads.length,
      manOfTheMatchSynced: payload.manOfTheMatchSynced ?? false,
      /** After merge/bonusify — `runs` is batting runs; `fantasyPts` adds wickets/catches/bonuses/runouts. */
      note:
        "`raw` is the full top-level API response for the winning path. `mergedParseTree` overlays currentMatches fields (batsman runs, etc.) before parsing — compare probe hits on both. Two innings → separate rows; merge uses Math.max per normalized name.",
      ...(wantRawDump
        ? {
            rawResponseJson: truncateJsonString(payload.raw),
            mergedParseTreeJson: truncateJsonString(payload.mergedParseTree),
          }
        : {}),
      ...(probe
        ? {
            probe,
            parsedForProbe: parsedForProbe
              ? {
                  name: parsedForProbe.name,
                  id: parsedForProbe.id ?? null,
                  runs: parsedForProbe.runs,
                  wickets: parsedForProbe.wickets,
                  catches: parsedForProbe.catches,
                  runouts: parsedForProbe.runouts ?? 0,
                  stumpings: parsedForProbe.stumpings ?? 0,
                  fifty_bonus: parsedForProbe.fifty_bonus,
                  hundred_bonus: parsedForProbe.hundred_bonus,
                }
              : null,
            probeRawHits: payload.raw ? probeRawRowsForPlayer(payload.raw, probe) : [],
            probeMergedHits: payload.mergedParseTree
              ? probeRawRowsForPlayer(payload.mergedParseTree, probe)
              : [],
            probeRawSnippets: payload.raw ? probeJsonSnippets(payload.raw, probe) : [],
            probeMergedSnippets: payload.mergedParseTree
              ? probeJsonSnippets(payload.mergedParseTree, probe)
              : [],
          }
        : {}),
      hint:
        players.length === 0
          ? "Zero player rows usually means match_scorecard / match_points failed or returned empty for this id — check CricAPI plan, quota, or id mismatch vs currentMatches."
          : !probe
            ? "Add &probe=Player%20Name for structured hits + JSON snippets; add &raw=1 for capped full raw + merged trees."
            : !wantRawDump
              ? "Add &raw=1 for capped JSON of the full API response and merged parse tree (~140k chars each)."
              : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        externalMatchId: id,
        error: e instanceof Error ? e.message : "refreshMatchFromProvider failed",
      },
      { status: 500 }
    );
  }
}
