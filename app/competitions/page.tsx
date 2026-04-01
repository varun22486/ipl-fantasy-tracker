import { Suspense } from "react";
import NavBar from "@/components/NavBar";
import ManageCompetitionsClient from "@/components/ManageCompetitionsClient";

export default function ManageCompetitionsPage() {
  return (
    <main className="page-main">
      <NavBar
        title="Manage leagues"
        subtitle="Remove custom competitions here. Deleting a league removes all picks for that league."
      />
      <Suspense fallback={<p style={{ color: "#64748b", margin: 0 }}>Loading…</p>}>
        <ManageCompetitionsClient />
      </Suspense>
    </main>
  );
}
