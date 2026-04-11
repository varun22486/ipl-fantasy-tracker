import { NextRequest, NextResponse } from "next/server";

/**
 * Debug endpoint: raw API samples + automated scan for playing-XI-related fields.
 * Usage: GET /api/debug-roster?id=MATCH_UUID
 *
 * Rotates CRICKET_API_KEY … CRICKET_API_KEY_12 like the app. Surfaces:
 * - Union of keys on player-shaped objects (name + id) under each payload
 * - Any object keys whose names look like playing XI / bench / impact (heuristic walk)
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: "Pass ?id=MATCH_UUID" }, { status: 400 });
  }

  const baseUrl = (process.env.CRICKET_API_BASE_URL || "https://api.cricapi.com").replace(/\/$/, "");
  const keys = [
    process.env.CRICKET_API_KEY,
    process.env.CRICKET_API_KEY_2,
    process.env.CRICKET_API_KEY_3,
    process.env.CRICKET_API_KEY_4,
    process.env.CRICKET_API_KEY_5,
    process.env.CRICKET_API_KEY_6,
    process.env.CRICKET_API_KEY_7,
    process.env.CRICKET_API_KEY_8,
    process.env.CRICKET_API_KEY_9,
    process.env.CRICKET_API_KEY_10,
    process.env.CRICKET_API_KEY_11,
    process.env.CRICKET_API_KEY_12,
  ]
    .map((k) => (typeof k === "string" ? k.replace(/[\u200B-\u200D\uFEFF]/g, "").trim() : ""))
    .filter(Boolean);

  async function fetchSuccess(path: string): Promise<{ json: any; keyAlias: string } | null> {
    for (const apiKey of keys.length ? keys : [""]) {
      if (!apiKey) continue;
      const sep = path.includes("?") ? "&" : "?";
      const url = `${baseUrl}${path}${sep}apikey=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!res.ok) continue;
      const json = await res.json();
      if (json?.status === "success") return { json, keyAlias: apiKey.slice(0, 8) };
    }
    return null;
  }

  type Playerish = Record<string, unknown>;

  function extractPlayerishFromData(data: unknown): Playerish[] {
    const out: Playerish[] = [];
    function walk(x: unknown, depth: number) {
      if (depth > 16 || out.length > 500) return;
      if (x == null || typeof x !== "object") return;
      if (Array.isArray(x)) {
        for (const item of x) walk(item, depth + 1);
        return;
      }
      const o = x as Playerish;
      const name = o.name ?? o.playerName;
      const pid = o.id ?? o.pid ?? o.playerId;
      const hasName = typeof name === "string" && name.length > 1 && name.toLowerCase() !== "extras";
      const hasId = typeof pid === "string" || typeof pid === "number";
      if (hasName && hasId) {
        out.push(o);
        return;
      }
      for (const v of Object.values(o)) walk(v, depth + 1);
    }
    walk(data, 0);
    return out;
  }

  function aggregatePlayerKeys(playerObjs: Playerish[]) {
    const acc: Record<string, { count: number; types: string[]; boolValues?: boolean[] }> = {};
    for (const o of playerObjs) {
      for (const [k, v] of Object.entries(o)) {
        if (!acc[k]) acc[k] = { count: 0, types: [] };
        acc[k].count++;
        const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
        if (!acc[k].types.includes(t)) acc[k].types.push(t);
        if (typeof v === "boolean") {
          if (!acc[k].boolValues) acc[k].boolValues = [];
          if (!acc[k].boolValues!.includes(v)) acc[k].boolValues!.push(v);
        }
      }
    }
    return acc;
  }

  /** Keys that often indicate lineups / subs / bench in cricket JSON feeds */
  const XI_NAME_RE =
    /playing|(^|[^a-z])xi([^a-z]|$)|lineup|line-up|starting|bench|substitut|impact|super.?sub|squad|eleven|11|benched|onfield|announced/i;

  function findXiNamedBranches(
    obj: unknown,
    path: string,
    hits: { path: string; key: string; valueKind: string; detail?: string }[],
    depth: number
  ) {
    if (depth > 14 || hits.length > 100) return;
    if (obj == null) return;
    if (Array.isArray(obj)) {
      const n = Math.min(obj.length, 8);
      for (let i = 0; i < n; i++) findXiNamedBranches(obj[i], `${path}[${i}]`, hits, depth + 1);
      return;
    }
    if (typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (XI_NAME_RE.test(k)) {
        let detail: string | undefined;
        let valueKind = typeof v;
        if (Array.isArray(v)) {
          valueKind = `array(len=${v.length})`;
          if (v.length && typeof v[0] === "object" && v[0] && !Array.isArray(v[0])) {
            detail = `elemKeys=${Object.keys(v[0] as object).slice(0, 12).join(",")}`;
          }
        } else if (v && typeof v === "object") {
          valueKind = "object";
          detail = `keys=${Object.keys(v).slice(0, 15).join(",")}`;
        }
        hits.push({ path: p, key: k, valueKind, detail });
      }
      findXiNamedBranches(v, p, hits, depth + 1);
    }
  }

  function summarizePayload(label: string, raw: any) {
    const data = raw?.data;
    const players = extractPlayerishFromData(data);
    const keyStats = aggregatePlayerKeys(players.slice(0, 120));
    const xiBranches: { path: string; key: string; valueKind: string; detail?: string }[] = [];
    findXiNamedBranches(data, "data", xiBranches, 0);
    return {
      status: raw?.status,
      reason: raw?.reason,
      keyAliasUsed: raw?._keyAlias,
      dataType: Array.isArray(data) ? `array[${data.length}]` : typeof data,
      topKeys: data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data).slice(0, 30) : [],
      playerishObjectCount: players.length,
      /** Every distinct field name seen on player-shaped dicts (name + id) */
      playerFieldInventory: keyStats,
      /** Branches whose property names look XI/bench/impact-related */
      xiRelatedBranches: xiBranches.slice(0, 80),
      firstPlayerSample: players[0] ?? null,
    };
  }

  const paths = [
    { label: "match_scorecard", path: `/v1/match_scorecard?offset=0&id=${encodeURIComponent(id)}` },
    { label: "match_squad", path: `/v1/match_squad?id=${encodeURIComponent(id)}` },
    { label: "match_info", path: `/v1/match_info?id=${encodeURIComponent(id)}` },
  ] as const;

  const byEndpoint: Record<string, ReturnType<typeof summarizePayload> | { error: string }> = {};

  for (const { label, path } of paths) {
    const got = await fetchSuccess(path);
    if (!got) {
      byEndpoint[label] = { error: "No key returned status=success (quota/rate-limit/wrong base URL?)" };
      continue;
    }
    (got.json as any)._keyAlias = got.keyAlias;
    byEndpoint[label] = summarizePayload(label, got.json);
  }

  const inv: Record<string, { count: number; types: string[]; boolValues?: boolean[] }> =
    byEndpoint.match_squad && "playerFieldInventory" in byEndpoint.match_squad
      ? (byEndpoint.match_squad.playerFieldInventory as typeof inv)
      : {};
  const invKeys = Object.keys(inv);
  const xiLikeKeys = invKeys.filter((k) =>
    /playing|xi|bench|substitut|impact|squad|order|position|lineup|starting|field/i.test(k)
  );
  const hasExplicitXiField = invKeys.some((k) =>
    /^(inPlayingXI|isPlayingXI|playingXI|onField|inSquad|isSubstitute|impactPlayer)$/i.test(k)
  );

  const conclusion = hasExplicitXiField
    ? "Player objects include at least one explicit XI/substitute-style field — wire those keys in cricket-provider."
    : xiLikeKeys.length === 0
      ? "On this sample, match_squad player objects do not expose dedicated playing-XI booleans or order fields — typically only name, role, battingStyle, bowlingStyle, country, id, playerImg. Toss-accurate XI is not available as a flag from this endpoint alone."
      : "Some ambiguous keys match a heuristic (e.g. role/squad); inspect playerFieldInventory — they may still not mean official playing 11.";

  return NextResponse.json({
    ok: true,
    matchId: id,
    keysConfigured: keys.length,
    endpoints: byEndpoint,
    playingXiFlagHints: {
      playerLevelKeysMatchingHeuristic: xiLikeKeys,
      note: conclusion,
    },
  });
}
