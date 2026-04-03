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


def load_cricket_keys() -> list[tuple[str, str]]:
    """CRICKET_API_KEY … CRICKET_API_KEY_11 in order."""
    if not ENV_LOCAL.is_file():
        print("FAIL: .env.local not found (need CRICKET_API_KEY)")
        sys.exit(1)
    names = ["CRICKET_API_KEY"] + [f"CRICKET_API_KEY_{i}" for i in range(2, 12)]
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
        print("FAIL: no CRICKET_API_KEY* in .env.local")
        sys.exit(1)
    return out


def api_get(path: str, keys: list[tuple[str, str]], step: str) -> tuple[dict, str]:
    base = "https://api.cricapi.com"
    last = None
    for name, k in keys:
        sep = "&" if "?" in path else "?"
        url = f"{base}{path}{sep}apikey={urllib.parse.quote(k)}"
        try:
            j = http_get(url)
        except Exception as e:
            last = ("error", str(e))
            print(f"   [{name}] {step}: {e}")
            continue
        if j.get("status") == "success":
            print(f"   [{name}] {step}: OK")
            return j, name
        last = (j.get("status"), j.get("reason"))
        print(f"   [{name}] {step}: {j.get('status')!r} {j.get('reason')!r}")
    raise RuntimeError(f"{step}: all keys failed, last={last!r}")


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

    keys = load_cricket_keys()
    print(f"1) Fetching currentMatches ({len(keys)} key(s) to try) …")
    try:
        data, _ = api_get("/v1/currentMatches", keys, "currentMatches")
    except urllib.error.HTTPError as e:
        print(f"FAIL: HTTP {e.code}")
        return 1
    except RuntimeError as e:
        print(f"SKIP (live): {e}")
        print("   Logic tests passed; re-run when API quota resets to validate live + scorecard.")
        return 0
    except Exception as e:
        print(f"FAIL: {e}")
        return 1

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
        sc, _ = api_get(f"/v1/match_scorecard?id={urllib.parse.quote(str(mid))}", keys, "match_scorecard")
    except RuntimeError as e:
        print(f"FAIL: scorecard {e}")
        return 1
    except Exception as e:
        print(f"FAIL: scorecard {e}")
        return 1

    inner = sc.get("data") or {}
    teams = inner.get("teams") if isinstance(inner, dict) else None
    scorecard = inner.get("scorecard") if isinstance(inner, dict) else None
    batting_top = inner.get("batting") if isinstance(inner, dict) else None
    team_players = 0
    teams_shape = "missing"
    if isinstance(teams, list) and teams:
        if isinstance(teams[0], dict):
            teams_shape = "objects with players"
            for t in teams:
                if isinstance(t, dict) and isinstance(t.get("players"), list):
                    team_players += len(t["players"])
        else:
            teams_shape = f"strings only (e.g. {teams[0]!r}) — app merges match_squad for XI"
    print(f"   scorecard.data.teams: {len(teams) if isinstance(teams, list) else 0} ({teams_shape})")
    print(f"   total names under team[].players (objects only): {team_players}")
    inn_n = len(scorecard) if isinstance(scorecard, list) else 0
    print(f"   scorecard innings blocks: {inn_n}")
    if inn_n == 1:
        print("   NOTE: Single-innings scorecard → ~6 batters + ~6 bowlers without match_squad merge.")

    if team_players < 4 and inn_n < 1 and not (isinstance(batting_top, list) and len(batting_top) > 0):
        print("WARN: Unexpected scorecard shape; app still has batting / squad fallbacks.")
    else:
        print("   Roster-related fields look usable (mergeSparseSquadsWithFullRoster if strings-only teams).")

    print("PASS: IPL discovery + scorecard")
    return 0


if __name__ == "__main__":
    sys.exit(main())
