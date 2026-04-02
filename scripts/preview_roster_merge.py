#!/usr/bin/env python3
"""
Live API preview: mirrors refreshMatchFromProvider roster path for sparse scorecards.
Fetches match_scorecard + match_squad, applies mergeSparseSquadsWithFullRoster logic.
"""
from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_LOCAL = ROOT / ".env.local"

# Copy of smoke_ipl IPL detection (minimal)
IPL_MARKERS = ("tata ipl", "indian premier league", " ipl ", "ipl 20")
IPL_TEAMS = (
    "chennai super kings", "delhi capitals", "gujarat titans", "kolkata knight riders",
    "lucknow super giants", "mumbai indians", "punjab kings", "rajasthan royals",
    "royal challengers bengaluru", "sunrisers hyderabad",
)


def load_cricket_keys() -> list[tuple[str, str]]:
    """All CRICKET_API_KEY … CRICKET_API_KEY_10 from .env.local (order preserved)."""
    if not ENV_LOCAL.is_file():
        print("No .env.local", file=sys.stderr)
        sys.exit(1)
    names = ["CRICKET_API_KEY"] + [f"CRICKET_API_KEY_{i}" for i in range(2, 11)]
    text = ENV_LOCAL.read_text().splitlines()
    out: list[tuple[str, str]] = []
    for name in names:
        prefix = f"{name}="
        for line in text:
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            if s.startswith(prefix):
                v = s.split("=", 1)[1].strip().strip('"').strip("'")
                if v:
                    out.append((name, v))
                break
    if not out:
        print("No CRICKET_API_KEY* in .env.local", file=sys.stderr)
        sys.exit(1)
    return out


def http_get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode())


def api_get(path: str, keys: list[tuple[str, str]], step: str) -> tuple[dict, str]:
    """
    GET https://api.cricapi.com{path} with ? or & apikey=.
    Tries each key until status == success. Prints which key worked (name only).
    """
    base = "https://api.cricapi.com"
    last: tuple[str, str] | None = None
    for name, k in keys:
        sep = "&" if "?" in path else "?"
        url = f"{base}{path}{sep}apikey={urllib.parse.quote(k)}"
        try:
            j = http_get(url)
        except Exception as e:
            last = ("error", str(e))
            print(f"  [{name}] {step}: HTTP {e}")
            continue
        if j.get("status") == "success":
            print(f"  [{name}] {step}: OK")
            return j, name
        reason = str(j.get("reason") or j.get("message") or "")
        last = (str(j.get("status")), reason)
        print(f"  [{name}] {step}: status={j.get('status')!r} reason={reason[:120]!r}")
    raise RuntimeError(f"{step}: all {len(keys)} keys failed. Last: {last}")


def teams_loosely_same(a: str, b: str) -> bool:
    la, lb = a.lower().strip(), b.lower().strip()
    if not la or not lb:
        return False
    if la == lb:
        return True
    return la in lb or lb in la


def merged_squads_from_one_innings(inn: dict, data: dict) -> list[dict]:
    """Mirror extractMergedSquadsFromScorecard for one SRH-bats-KKR-bowls style innings."""
    bt = str(inn.get("inning") or "").strip()
    if not bt:
        return []
    # strip " Inning 1" style
    for suf in (" Inning 1", " Inning 2", " 1st Innings", " 2nd Innings"):
        if bt.endswith(suf):
            bt = bt[: -len(suf)].strip()
    sides = [bt]
    api_teams = data.get("teams") or []
    other = None
    if isinstance(api_teams, list) and len(api_teams) >= 2:
        for t in api_teams:
            ts = t if isinstance(t, str) else str((t or {}).get("name") or (t or {}).get("teamName") or "")
            if ts and not teams_loosely_same(ts, bt):
                other = ts
                break
    if not other:
        return []

    batting_team = bt
    bowling_team = other
    bat_set: dict[str, str] = {}
    bowl_set: dict[str, str] = {}

    for row in inn.get("batting") or []:
        b = row.get("batsman")
        if isinstance(b, dict):
            n = (b.get("name") or "").strip()
        else:
            n = str(b or "").strip()
        if n and n.lower() != "extras":
            bat_set[n] = n

    for row in inn.get("bowling") or []:
        b = row.get("bowler")
        if isinstance(b, dict):
            n = (b.get("name") or "").strip()
        else:
            n = str(b or "").strip()
        if n and n.lower() != "extras":
            bowl_set[n] = n

    return [
        {"teamName": batting_team, "players": list(bat_set.keys())},
        {"teamName": bowling_team, "players": list(bowl_set.keys())},
    ]


def parse_match_squad(data) -> list[dict]:
    out = []
    if not isinstance(data, list):
        return out
    for t in data:
        if not isinstance(t, dict):
            continue
        tn = (t.get("name") or t.get("teamName") or "").strip() or "Team"
        pl = t.get("players") or []
        names = []
        for p in pl:
            if isinstance(p, str):
                names.append(p.strip())
            elif isinstance(p, dict):
                n = (p.get("name") or p.get("playerName") or p.get("fullName") or "").strip()
                if n:
                    names.append(n)
        if names:
            out.append({"teamName": tn, "players": names})
    return out


def merge_sparse_with_full(sparse: list[dict], full: list[dict], cap: int = 11) -> list[dict]:
    out = []
    for s in sparse:
        sname = s["teamName"]
        spl = s.get("players") or []
        match = next((f for f in full if teams_loosely_same(f["teamName"], sname)), None)
        seen = set()
        names = []
        for n in spl:
            k = n.lower()
            if k in seen:
                continue
            seen.add(k)
            names.append(n)
        if match:
            for n in match.get("players") or []:
                if len(names) >= cap:
                    break
                k = n.lower()
                if k in seen:
                    continue
                seen.add(k)
                names.append(n)
        out.append({"teamName": sname, "players": names[:cap]})
    return out


def is_probably_ipl(m: dict) -> bool:
    blob = " ".join(
        str(m.get(k) or "") for k in ("name", "matchDesc", "series", "seriesName", "status", "venue")
    ).lower()
    if any(x in blob for x in IPL_MARKERS):
        return True
    return sum(1 for t in IPL_TEAMS if t in blob) >= 2


def main() -> int:
    keys = load_cricket_keys()
    print(f"Loaded {len(keys)} API key(s) from .env.local (try in order until success).\n")

    print("=== 1) currentMatches ===")
    try:
        cm, _ = api_get("/v1/currentMatches", keys, "currentMatches")
    except RuntimeError as e:
        print(f"FAIL: {e}")
        return 1

    raw = cm.get("data") or []
    ipl = [m for m in raw if isinstance(m, dict) and is_probably_ipl(m)]
    if not ipl:
        print("No IPL match in feed right now.")
        return 0
    pick = ipl[0]
    mid = pick.get("id") or pick.get("matchId")
    desc = pick.get("name") or pick.get("matchDesc") or mid
    print(f"Picked: {desc!r}\nid={mid}")

    print("\n=== 2) match_scorecard ===")
    try:
        sc, _ = api_get(f"/v1/match_scorecard?id={urllib.parse.quote(str(mid))}", keys, "match_scorecard")
    except RuntimeError as e:
        print(f"FAIL: {e}")
        return 1
    d = sc.get("data") or {}
    teams_field = d.get("teams")
    sc_blocks = d.get("scorecard") or []
    print(f"data.teams type: {type(teams_field).__name__}  sample: {repr(str(teams_field)[:120])}")
    print(f"scorecard innings: {len(sc_blocks) if isinstance(sc_blocks, list) else 0}")

    sparse = []
    if isinstance(sc_blocks, list) and sc_blocks:
        for inn in sc_blocks:
            if isinstance(inn, dict):
                sparse = merged_squads_from_one_innings(inn, d)
                if sparse:
                    break
    print("\n--- Sparse (scorecard merge only, like old 6+6) ---")
    for t in sparse:
        print(f"  {t['teamName']}: {len(t['players'])} players")
        print(f"    {t['players']}")

    print("\n=== 3) match_squad ===")
    try:
        sq, _ = api_get(f"/v1/match_squad?id={urllib.parse.quote(str(mid))}", keys, "match_squad")
    except RuntimeError as e:
        print(f"FAIL: {e}")
        print("(Cannot show merged XI without squad.)")
        return 0
    full = parse_match_squad(sq.get("data"))
    print(f"Squad teams: {len(full)}")
    for t in full:
        print(f"  {t['teamName']}: {len(t['players'])} in squad feed")

    if len(sparse) >= 2 and full:
        merged = merge_sparse_with_full(sparse, full)
        print("\n--- After mergeSparseSquadsWithFullRoster (latest app logic) ---")
        for t in merged:
            print(f"  {t['teamName']}: {len(t['players'])} players")
            print(f"    {t['players']}")
    else:
        print("\n(Skip merge: need 2 sparse sides + squad data.)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
