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

  // Extract match number: "7th Match", "Match 8". If several ordinals appear (e.g. series + league),
  // use the last "Nth Match" — it usually matches the IPL league counter the board uses.
  const ordinals: string[] = [];
  const ordRe = /\b(\d+)(?:st|nd|rd|th)\s+Match\b/gi;
  let om: RegExpExecArray | null;
  while ((om = ordRe.exec(rest)) !== null) ordinals.push(om[1]);
  if (ordinals.length > 0) {
    return `${t1} vs ${t2}, Match ${ordinals[ordinals.length - 1]}`;
  }
  const plainRe = /\bMatch\s+(\d+)\b/gi;
  const plain: string[] = [];
  while ((om = plainRe.exec(rest)) !== null) plain.push(om[1]);
  if (plain.length > 0) {
    return `${t1} vs ${t2}, Match ${plain[plain.length - 1]}`;
  }

  // Strip "Indian Premier League YYYY" suffix if nothing else useful remains
  const cleaned = rest.replace(/,?\s*Indian Premier League.*$/i, "").trim();
  return cleaned ? `${t1} vs ${t2}, ${cleaned}` : `${t1} vs ${t2}`;
}
