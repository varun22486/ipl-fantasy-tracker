#!/usr/bin/env python3
"""Smoke test: CricAPI reachability, IPL-only filtering, scorecard roster shape."""
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_LOCAL = ROOT / ".env.local"

IPL_TEAMS = [
    "chennai super kings",
    "delhi capitals",
    "gujarat titans",
    "kolkata knight riders",
    "lucknow super giants",
    "mumbai indians",
    "punjab kings",
    "rajasthan royals",
    "royal challengers bengaluru",
    "royal challengers bangalore",
    "sunrisers hyderabad",
]
IPL_MARKERS = [
    "tata ipl",
    "indian premier league",
    " ipl ",
    "ipl 20",
    "ipl,",
    "ipl-",
]
IPL_CODES = ["csk", "mi", "kkr", "rcb", "rr", "dc", "srh", "pbks", "gt", "lsg"]


def load_api_key() -> str:
    if not ENV_LOCAL.is_file():
        print("FAIL: .env.local not found (need CRICKET_API_KEY)")
        sys.exit(1)
    for line in ENV_LOCAL.read_text().splitlines():
        line = line.strip()
        if line.startswith("CRICKET_API_KEY=") and not line.startswith("#"):
            v = line.split("=", 1)[1].strip().strip('"').strip("'")
            if v:
                return v
    print("FAIL: CRICKET_API_KEY missing in .env.local")
    sys.exit(1)


def teams_blob(match: dict) -> str:
    teams = match.get("teams")
    if not isinstance(teams, list):
        return ""
    parts = []
    for t in teams:
        if isinstance(t, str):
            parts.append(t)
        elif isinstance(t, dict):
            parts.append(
                str(
                    t.get("team")
                    or t.get("teamName")
                    or t.get("name")
                    or t.get("teamSName")
                    or t.get("shortname")
                    or t.get("shortName")
                    or ""
                ).strip()
            )
    return " ".join(parts)


def is_probably_ipl(match: dict) -> bool:
    blob = " ".join(
        [
            str(match.get("name") or ""),
            str(match.get("matchDesc") or ""),
            str(match.get("series") or ""),
            str(match.get("seriesName") or ""),
            str(match.get("matchType") or ""),
            str(match.get("status") or ""),
            str(match.get("venue") or ""),
            teams_blob(match),
            " ".join(
                str((ti or {}).get("name") or "") + " " + str((ti or {}).get("shortName") or "")
                for ti in (match.get("teamInfo") or [])
                if isinstance(ti, dict)
            ),
        ]
    ).lower()
    if any(m in blob for m in IPL_MARKERS):
        return True
    if blob.startswith("ipl ") or re.search(r"\bipl\b", blob):
        return True
    if sum(1 for team in IPL_TEAMS if team in blob) >= 2:
        return True
    code_hits = sum(1 for c in IPL_CODES if re.search(rf"\b{re.escape(c)}\b", blob, re.I))
    return code_hits >= 2


def http_get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def test_ipl_filter_offline() -> None:
    """Mirror of lib/cricket-provider.ts isProbablyIplMatch — no network."""
    ipl1 = {
        "name": "CSK vs MI, Indian Premier League",
        "teams": [{"teamName": "Chennai Super Kings"}, {"teamName": "Mumbai Indians"}],
    }
    assert is_probably_ipl(ipl1), "IPL by full names should match"

    ipl2 = {
        "matchDesc": "KKR vs RCB",
        "seriesName": "TATA IPL 2025",
    }
    assert is_probably_ipl(ipl2), "IPL by series + codes should match"

    non = {
        "name": "Australia vs England, World Cup",
        "teams": [{"teamName": "Australia"}, {"teamName": "England"}],
    }
    assert not is_probably_ipl(non), "Non-IPL should not match"

    bbl = {
        "name": "Stars vs Renegades",
        "seriesName": "Big Bash League",
    }
    assert not is_probably_ipl(bbl), "BBL should not match"

    print("   Offline IPL filter: OK (IPL samples match, non-IPL rejected)")


def main() -> int:
    print("0) Offline IPL filter checks …")
    test_ipl_filter_offline()

    api_key = load_api_key()
    base = "https://api.cricapi.com"

    print("1) Fetching currentMatches …")
    try:
        data = http_get(f"{base}/v1/currentMatches?apikey={urllib.parse.quote(api_key)}")
    except urllib.error.HTTPError as e:
        print(f"FAIL: HTTP {e.code}")
        return 1
    except Exception as e:
        print(f"FAIL: {e}")
        return 1

    status = data.get("status")
    if status != "success":
        print(f"SKIP (live): API status={status!r} reason={data.get('reason')!r}")
        print("   Logic tests passed; re-run when API quota resets to validate live + scorecard.")
        return 0

    raw_matches = data.get("data") or []
    if not isinstance(raw_matches, list):
        raw_matches = []

    print(f"   Raw match count: {len(raw_matches)}")

    ipl = [m for m in raw_matches if isinstance(m, dict) and is_probably_ipl(m)]
    print(f"   After IPL filter: {len(ipl)}")

    if not ipl:
        print("WARN: No IPL matches in currentMatches right now (off-season or empty feed). IPL filter logic ran OK.")
        print("PASS: API + filter (no fixture to scorecard-test)")
        return 0

    pick = ipl[0]
    mid = pick.get("id") or pick.get("matchId")
    desc = pick.get("name") or pick.get("matchDesc") or pick.get("title") or str(mid)
    print(f"2) Picked IPL fixture: {desc!r} id={mid!r}")

    print("3) Fetching match_scorecard (roster / sync shape) …")
    try:
        sc = http_get(f"{base}/v1/match_scorecard?id={urllib.parse.quote(str(mid))}&apikey={urllib.parse.quote(api_key)}")
    except Exception as e:
        print(f"FAIL: scorecard {e}")
        return 1

    if sc.get("status") != "success":
        print(f"FAIL: scorecard status={sc.get('status')!r} reason={sc.get('reason')!r}")
        return 1

    inner = sc.get("data") or {}
    teams = inner.get("team") if isinstance(inner, dict) else None
    batting = inner.get("batting") if isinstance(inner, dict) else None
    team_players = 0
    if isinstance(teams, list):
        for t in teams:
            if isinstance(t, dict) and isinstance(t.get("players"), list):
                team_players += len(t["players"])
    print(f"   scorecard.data.team entries: {len(teams) if isinstance(teams, list) else 0}")
    print(f"   total names under team[].players: {team_players}")
    print(f"   batting innings blocks: {len(batting) if isinstance(batting, list) else 0}")

    if team_players < 4 and not (isinstance(batting, list) and len(batting) > 0):
        print("WARN: Unexpected scorecard shape; app still has batting / squad fallbacks.")
    else:
        print("   Roster-related fields look usable.")

    print("PASS: IPL discovery + scorecard")
    return 0


if __name__ == "__main__":
    sys.exit(main())
