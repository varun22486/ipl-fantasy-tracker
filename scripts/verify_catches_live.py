#!/usr/bin/env python3
"""
Pull CricAPI match_scorecard for a fixture and count catches like lib/cricket-provider.ts
(parseCaughtFielderFromDismissalText + wicket fall + batting dismissals).

No pip / npm — only stdlib. Uses CRICKET_API_KEY* from .env.local (same as smoke_ipl.py).

  python3 scripts/verify_catches_live.py
  python3 scripts/verify_catches_live.py --match-id <uuid> --expect 2 --player "Ishan Kishan"
  python3 scripts/verify_catches_live.py --dump /tmp/scorecard.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ENV_LOCAL = ROOT / ".env.local"

DEFAULT_MATCH = "d8360a13-342f-45b7-9f71-060e852777ec"


def load_cricket_keys() -> list[tuple[str, str]]:
    if not ENV_LOCAL.is_file():
        print("ERROR: .env.local not found (need CRICKET_API_KEY)", file=sys.stderr)
        sys.exit(1)
    names = ["CRICKET_API_KEY"] + [f"CRICKET_API_KEY_{i}" for i in range(2, 13)]
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
        print("ERROR: no CRICKET_API_KEY* in .env.local", file=sys.stderr)
        sys.exit(1)
    return out


def http_get(url: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def api_scorecard(match_id: str, keys: list[tuple[str, str]]) -> dict[str, Any]:
    path = f"/v1/match_scorecard?offset=0&id={urllib.parse.quote(match_id)}"
    base = "https://api.cricapi.com"
    last = None
    for name, k in keys:
        sep = "&" if "?" in path else "?"
        url = f"{base}{path}{sep}apikey={urllib.parse.quote(k)}"
        try:
            j = http_get(url)
        except Exception as e:
            last = str(e)
            print(f"   [{name}] scorecard: {e}", file=sys.stderr)
            continue
        if j.get("status") == "success" and j.get("data") is not None:
            print(f"   [{name}] match_scorecard: OK")
            return j
        last = (j.get("status"), j.get("reason"))
        print(f"   [{name}] scorecard: {j.get('status')!r} {j.get('reason')!r}", file=sys.stderr)
    raise RuntimeError(f"scorecard: all keys failed, last={last!r}")


def safe_str(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


def parse_caught_fielder_from_text(text: str) -> str | None:
    s = safe_str(text)
    if not s:
        return None
    if re.match(r"^c\s*(?:&|and)\s*b\s+", s, re.I):
        return None
    m = re.match(r"^c\s+(.+?)\s+b\s+", s, re.I)
    if m:
        n = re.sub(r"\s*\([^)]*\)\s*", " ", m.group(1))
        n = re.sub(r"\s+", " ", n).strip()
        return n or None
    m = re.match(r"^caught\s+(?:by\s+)?(.+?)\s+b\s+", s, re.I)
    if m:
        n = re.sub(r"\s*\([^)]*\)\s*", " ", m.group(1))
        n = re.sub(r"\s+", " ", n).strip()
        return n or None
    return None


def player_name(field: Any) -> str | None:
    if isinstance(field, str) and field.strip():
        return field.strip()
    if isinstance(field, dict) and isinstance(field.get("name"), str) and field["name"].strip():
        return field["name"].strip()
    return None


def normalize_innings_list(data: dict[str, Any]) -> list[Any]:
    sc = data.get("scorecard")
    if isinstance(sc, list) and sc:
        return sc
    sc2 = data.get("scoreCard")
    if isinstance(sc2, list) and sc2:
        return sc2
    bat = data.get("batting")
    if isinstance(bat, list) and bat:
        return bat
    inn = data.get("innings")
    if isinstance(inn, list) and inn:
        return inn
    return []


def innings_batting_rows(inn: Any) -> list[Any]:
    if not isinstance(inn, dict):
        return []
    for key in ("batting", "batsman", "batsmen"):
        a = inn.get(key)
        if isinstance(a, list) and a:
            return a
    return []


def add_catch(ct: Counter[str], name: str) -> None:
    k = name.lower().strip()
    if k:
        ct[k] += 1


def process_batting_catches(b: dict[str, Any], ct: Counter[str]) -> None:
    dt = safe_str(b.get("dismissal-text") or b.get("dismissalText"))
    dismissal = safe_str(b.get("dismissal") or b.get("howOut") or "").lower()
    looks_caught = (
        "catch" in dismissal
        or dismissal == "caught"
        or dismissal == "cb"
        or (bool(dt) and re.search(r"^c[\s&]", dt, re.I))
    )
    if not looks_caught:
        return

    if dt:
        cnb = re.match(r"^c\s*(?:&|and)\s*b\s+(.+)", dt, re.I)
        if cnb:
            bf = b.get("bowler")
            name = player_name(bf) or cnb.group(1).strip()
            if name:
                add_catch(ct, name)
            return
        ft = parse_caught_fielder_from_text(dt)
        if ft:
            add_catch(ct, ft)
            return

    cf = b.get("catcher")
    if cf:
        cn = player_name(cf) if not isinstance(cf, str) else cf.strip()
        if isinstance(cf, str):
            cn = cf.strip()
        if cn:
            add_catch(ct, cn)


def process_wicket_catches(w: dict[str, Any], ct: Counter[str]) -> None:
    kind = safe_str(w.get("kind") or w.get("howOut") or w.get("dismissalKind"))
    dismissal = safe_str(w.get("dismissal") or w.get("desc") or w.get("dismissalText"))
    dt_extra = safe_str(w.get("dismissal-text") or w.get("dismissalText"))
    is_caught = bool(
        re.search(r"caught", kind, re.I)
        or re.match(r"^c\s+(?!&\s*b\s)\w", dismissal, re.I)
        or re.match(r"^caught\b", dismissal, re.I)
        or re.match(r"^c\s+(?!&\s*b\s)\w", dt_extra, re.I)
        or re.match(r"^caught\b", dt_extra, re.I)
    )
    if not is_caught:
        return

    raw = w.get("fielder") or w.get("fielders") or w.get("catcher_player")
    fielders: list[Any] = raw if isinstance(raw, list) else ([raw] if raw else [])
    added = 0
    for f in fielders:
        if isinstance(f, str) and f.strip():
            add_catch(ct, f.strip())
            added += 1
        elif isinstance(f, dict):
            n = safe_str(f.get("name") or f.get("playerName") or f.get("fullName"))
            if n:
                add_catch(ct, n)
                added += 1

    if added == 0:
        combined = " ".join(x for x in (dismissal, dt_extra) if x)
        ft = (
            parse_caught_fielder_from_text(combined)
            or parse_caught_fielder_from_text(dismissal)
            or parse_caught_fielder_from_text(dt_extra)
        )
        if ft:
            add_catch(ct, ft)


def count_wicket_derived_catches(data: dict[str, Any]) -> Counter[str]:
    ct: Counter[str] = Counter()
    for inn in normalize_innings_list(data):
        if isinstance(inn, dict):
            for wk in ("wickets", "fall_wickets", "fallWickets"):
                arr = inn.get(wk)
                if isinstance(arr, list):
                    for w in arr:
                        if isinstance(w, dict):
                            process_wicket_catches(w, ct)
    for wk in ("wickets", "fall_wickets", "fallWickets"):
        arr = data.get(wk)
        if isinstance(arr, list):
            for w in arr:
                if isinstance(w, dict):
                    process_wicket_catches(w, ct)
    return ct


def count_batting_dismissal_catches(data: dict[str, Any]) -> Counter[str]:
    ct: Counter[str] = Counter()
    for inn in normalize_innings_list(data):
        if isinstance(inn, dict):
            for row in innings_batting_rows(inn):
                if isinstance(row, dict):
                    process_batting_catches(row, ct)
    return ct


def count_batting_ct_column(data: dict[str, Any]) -> Counter[str]:
    """Mirrors batting-row `ct` / `c` in collectPlayerRows."""
    ct: Counter[str] = Counter()
    for inn in normalize_innings_list(data):
        if not isinstance(inn, dict):
            continue
        for row in innings_batting_rows(inn):
            if not isinstance(row, dict):
                continue
            name = player_name(row.get("batsman"))
            if not name:
                continue
            raw = row.get("ct") if row.get("ct") is not None else row.get("c")
            try:
                n = int(raw) if raw is not None else 0
            except (TypeError, ValueError):
                n = 0
            if n > 0:
                ct[name.lower().strip()] = max(ct[name.lower().strip()], n)
    return ct


def merged_catch_totals(data: dict[str, Any]) -> dict[str, int]:
    """Like mergePlayers + patch: max per player across wicket text, dismissal text, and `ct` column."""
    cw = count_wicket_derived_catches(data)
    cd = count_batting_dismissal_catches(data)
    ccol = count_batting_ct_column(data)
    keys = set(cw) | set(cd) | set(ccol)
    return {k: max(cw.get(k, 0), cd.get(k, 0), ccol.get(k, 0)) for k in keys}


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch CricAPI scorecard and verify catcher dismissals count.")
    ap.add_argument("--match-id", default=os_env_or_default("TEST_CRICKET_MATCH_ID", DEFAULT_MATCH))
    ap.add_argument("--expect", type=int, default=int(os_env_or_default("EXPECT_ISHAN_CATCHES", "2")))
    ap.add_argument("--player", default="Ishan Kishan", help="Player name to check (substring match on keys)")
    ap.add_argument(
        "--dump",
        metavar="FILE",
        help="Write the full CricAPI JSON response (status, data, info, …) to FILE, pretty-printed.",
    )
    ap.add_argument(
        "--dump-data-only",
        metavar="FILE",
        help="Write only the `data` object to FILE (smaller; same shape the app merges for stats).",
    )
    args = ap.parse_args()

    keys = load_cricket_keys()
    print(f"Fetching match_scorecard id={args.match_id!r} …")
    j = api_scorecard(args.match_id, keys)

    if args.dump:
        out = Path(args.dump)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(j, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Wrote full API response → {out.resolve()}")
    if args.dump_data_only:
        out = Path(args.dump_data_only)
        out.parent.mkdir(parents=True, exist_ok=True)
        blob = j.get("data")
        out.write_text(json.dumps(blob, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Wrote response.data only → {out.resolve()}")

    data = j.get("data")
    if not isinstance(data, dict):
        print("ERROR: response has no data object", file=sys.stderr)
        sys.exit(1)

    merged = merged_catch_totals(data)
    want = args.player.lower().replace("  ", " ").strip()
    hits = [(k, v) for k, v in merged.items() if want in k]
    total = max((v for _, v in hits), default=0)

    print("\nMerged catch totals (max of wicket-fall + batting dismissals + batting `ct`):")
    for k, v in sorted(merged.items(), key=lambda x: (-x[1], x[0]))[:25]:
        print(f"  {v}  {k}")
    if len(merged) > 25:
        print(f"  … {len(merged) - 25} more")

    print(f"\nPlayer filter {args.player!r} → row(s): {hits!r} → total = {total}")
    print(f"Expected: {args.expect}")

    if total == args.expect:
        print("OK — matches expected.")
        sys.exit(0)
    print("FAIL — count does not match expected.", file=sys.stderr)
    sys.exit(1)


def os_env_or_default(name: str, default: str) -> str:
    v = os.environ.get(name)
    return v.strip() if v and v.strip() else default


if __name__ == "__main__":
    main()
