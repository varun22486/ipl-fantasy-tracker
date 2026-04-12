const TEAM_ABBR: Record<string, string> = {
  "royal challengers bengaluru": "RCB",
  "royal challengers bangalore": "RCB",
  "sunrisers hyderabad": "SRH",
  "mumbai indians": "MI",
  "kolkata knight riders": "KKR",
  "chennai super kings": "CSK",
  "delhi capitals": "DC",
  "rajasthan royals": "RR",
  "punjab kings": "PBKS",
  "kings xi punjab": "PBKS",
  "lucknow super giants": "LSG",
  "gujarat titans": "GT",
};

function teamAbbr(name: string): string {
  return TEAM_ABBR[name.trim().toLowerCase()] ?? name.trim();
}

function gatherOrdinalMatchNumbers(text: string): string[] {
  const out: string[] = [];
  const re = /\b(\d+)(?:st|nd|rd|th)\s+Match\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

function gatherPlainMatchNumbers(text: string): string[] {
  const out: string[] = [];
  const re = /\bMatch\s+(\d+)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/** Prefer ordinals in the IPL clause (same rules as formatFixture). */
function iplClauseMatchNumberToken(rest: string): string | null {
  const iplIdx = rest.search(/\b(?:Indian\s+Premier\s+League|Tata\s+IPL|IPL,?\s*20\d{2})\b/i);
  const iplTail = iplIdx >= 0 ? rest.slice(iplIdx) : "";
  const ordIpl = gatherOrdinalMatchNumbers(iplTail);
  const ordAll = gatherOrdinalMatchNumbers(rest);
  const ordPick = ordIpl.length > 0 ? ordIpl[ordIpl.length - 1]! : ordAll.length > 0 ? ordAll[ordAll.length - 1]! : null;
  if (ordPick) return ordPick;
  const plainIpl = gatherPlainMatchNumbers(iplTail);
  const plainAll = gatherPlainMatchNumbers(rest);
  return plainIpl.length > 0 ? plainIpl[plainIpl.length - 1]! : plainAll.length > 0 ? plainAll[plainAll.length - 1]! : null;
}

/**
 * League match index from a provider fixture string (e.g. 7 for "7th Match" in IPL clause).
 * Used with match_date to order "next match" and keep schedule consistent.
 */
export function parseLeagueMatchNumberFromFixture(fixture: string | null | undefined): number | null {
  if (!fixture) return null;
  const vsIdx = fixture.search(/\s+vs\s+/i);
  if (vsIdx === -1) return null;
  const afterVs = fixture.slice(vsIdx).replace(/^\s*vs\s+/i, "");
  const commaIdx = afterVs.indexOf(",");
  const rest = commaIdx === -1 ? "" : afterVs.slice(commaIdx + 1).trim();
  const tok = iplClauseMatchNumberToken(rest);
  if (!tok) return null;
  const n = parseInt(tok, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Shortens a full IPL fixture string for display.
 * "Royal Challengers Bengaluru vs Sunrisers Hyderabad, 1st Match, Indian Premier League 2026"
 *  → "RCB vs SRH, Match 1"
 */
export function formatFixture(fixture: string | null | undefined): string {
  if (!fixture) return "";

  // Split on " vs " first
  const vsIdx = fixture.search(/\s+vs\s+/i);
  if (vsIdx === -1) return fixture;

  const team1Raw = fixture.slice(0, vsIdx).trim();
  const afterVs = fixture.slice(vsIdx).replace(/^\s*vs\s*/i, "");

  // team2 ends at first comma
  const commaIdx = afterVs.indexOf(",");
  const team2Raw = commaIdx === -1 ? afterVs : afterVs.slice(0, commaIdx);
  const rest = commaIdx === -1 ? "" : afterVs.slice(commaIdx + 1).trim();

  const t1 = teamAbbr(team1Raw);
  const t2 = teamAbbr(team2Raw);

  const leagueN = parseLeagueMatchNumberFromFixture(fixture);
  if (leagueN != null) return `${t1} vs ${t2}, Match ${leagueN}`;

  // Strip "Indian Premier League YYYY" suffix if nothing else useful remains
  const cleaned = rest.replace(/,?\s*Indian Premier League.*$/i, "").trim();
  return cleaned ? `${t1} vs ${t2}, ${cleaned}` : `${t1} vs ${t2}`;
}

/** Link IPL picker — show COMPLETED / LIVE / SCHEDULED / NO_RESULT in uppercase. */
export function displayMatchStatusForPicker(status: string | undefined): string {
  const s = (status ?? "").trim();
  if (!s) return "—";
  return s.length <= 48 ? s.toUpperCase() : s;
}
