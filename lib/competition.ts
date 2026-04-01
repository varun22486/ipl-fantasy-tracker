import { cookies } from "next/headers";
import { parseCompetitionId } from "@/lib/competition-id";

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
