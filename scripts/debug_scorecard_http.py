#!/usr/bin/env python3
"""Call the app's debug-scorecard API (runs full TS provider + parse pipeline).

Requires: `npm run dev` in another terminal, and .env.local loaded by Next.

Usage:
  python3 scripts/debug_scorecard_http.py 05d33d50-3efe-42f9-98f7-1f363a2f153a
  python3 scripts/debug_scorecard_http.py 05d33d50... --base http://127.0.0.1:3000 --raw
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request


def main() -> int:
    p = argparse.ArgumentParser(description="GET /api/debug-scorecard?id=…")
    p.add_argument("match_id", help="CricAPI external match UUID")
    p.add_argument("--base", default="http://localhost:3000", help="Next origin (default: http://localhost:3000)")
    p.add_argument("--raw", action="store_true", help="Request raw=1 (large JSON)")
    args = p.parse_args()
    mid = args.match_id.strip()
    q = urllib.parse.urlencode({"id": mid, **({"raw": "1"} if args.raw else {})})
    url = f"{args.base.rstrip('/')}/api/debug-scorecard?{q}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read().decode()
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:2000]}", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"Request failed: {e}\nIs Next dev running? ({args.base})", file=sys.stderr)
        return 1

    try:
        j = json.loads(body)
    except json.JSONDecodeError:
        print(body[:4000])
        return 1

    if not j.get("ok"):
        print(json.dumps(j, indent=2))
        return 1

    # Short summary (full `players` can be long)
    summary = {
        "ok": j.get("ok"),
        "externalMatchId": j.get("externalMatchId"),
        "providerFetchPath": j.get("providerFetchPath"),
        "fixture": j.get("fixture"),
        "status": j.get("status"),
        "playerCount": j.get("playerCount"),
        "live_summary": (j.get("live_summary") or "")[:240],
        "rosterNameCount": j.get("rosterNameCount"),
        "manOfTheMatchSynced": j.get("manOfTheMatchSynced"),
        "players_sample": (j.get("players") or [])[:8],
    }
    print(json.dumps(summary, indent=2))
    if j.get("playerCount") == 0:
        print(
            "\n⚠ playerCount=0 → sync updates result text but not fantasy rows. "
            "Compare providerFetchPath; try --raw or /api/debug-scorecard?raw=1 in browser.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
