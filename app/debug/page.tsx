export const dynamic = "force-dynamic";

import { resolveCompetitionId } from "@/lib/competition";
import { supabaseAdmin } from "@/lib/supabase-admin";
import NavBar from "@/components/NavBar";
import DebugPageClient from "@/components/DebugPageClient";
import { readActiveMatchCookieValue } from "@/lib/active-match";

export default async function DebugPage({ searchParams }: { searchParams: Promise<{ c?: string; m?: string }> }) {
  const { c, m } = await searchParams;
  const competitionId = await resolveCompetitionId(c);
  const cookieVal = await readActiveMatchCookieValue();

  const { data: matches } = await supabaseAdmin
    .from("matches")
    .select("id, fixture")
    .order("id", { ascending: false });

  const list = (matches ?? []) as { id: number; fixture: string | null }[];

  let initialMatchId: number | null = null;
  const q = m?.trim() ? parseInt(m, 10) : NaN;
  if (Number.isFinite(q) && list.some((row) => row.id === q)) {
    initialMatchId = q;
  } else {
    const cCookie = cookieVal?.trim() ? parseInt(cookieVal, 10) : NaN;
    if (Number.isFinite(cCookie) && list.some((row) => row.id === cCookie)) {
      initialMatchId = cCookie;
    } else if (list[0]) {
      initialMatchId = list[0].id;
    }
  }

  const competitionQuery = competitionId != null ? `c=${encodeURIComponent(String(competitionId))}` : "";

  return (
    <main className="page-main">
      <NavBar
        title="Debug"
        subtitle="Last sync payload, audit trail, snapshots, and API links — not shown on Match pages."
      />
      <DebugPageClient
        matches={list}
        competitionId={competitionId}
        initialMatchId={initialMatchId}
        competitionQuery={competitionQuery}
      />
    </main>
  );
}
