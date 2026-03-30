export const dynamic = "force-dynamic";
export const revalidate = 0;

import { supabaseAdmin } from "@/lib/supabase-admin";
import NavBar from "@/components/NavBar";
import SettingsClient from "@/components/SettingsClient";

async function getData() {
  const { data } = await supabaseAdmin
    .from("series_settings")
    .select("*")
    .limit(1)
    .single();
  return data ?? {};
}

export default async function SettingsPage() {
  const settings = await getData();
  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: 24 }}>
      <NavBar title="Settings" subtitle="Names & scoring rules" />
      <SettingsClient settings={settings as any} />
    </main>
  );
}
