import { cookies } from "next/headers";

/** Valid positive DB id only — avoids NaN / 0 breaking Supabase filters. */
function parseCompetitionId(raw: string | undefined | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n !== Math.floor(n)) return null;
  return n;
}

/**
 * Resolve the active competition ID from URL search params (priority)
 * or the active_comp cookie (fallback so it persists across navigation).
 */
export async function resolveCompetitionId(
  searchParamC: string | undefined
): Promise<number | null> {
  const fromUrl = parseCompetitionId(searchParamC);
  if (fromUrl != null) return fromUrl;
  const cookieStore = await cookies();
  const cookieVal = cookieStore.get("active_comp")?.value;
  return parseCompetitionId(cookieVal ?? undefined);
}
