import { cookies } from "next/headers";

/**
 * Resolve the active competition ID from URL search params (priority)
 * or the active_comp cookie (fallback so it persists across navigation).
 */
export async function resolveCompetitionId(
  searchParamC: string | undefined
): Promise<number | null> {
  if (searchParamC) return Number(searchParamC);
  const cookieStore = await cookies();
  const cookieVal = cookieStore.get("active_comp")?.value;
  return cookieVal ? Number(cookieVal) : null;
}
