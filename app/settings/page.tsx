export const dynamic = "force-dynamic";
export const revalidate = 0;

import { supabaseAdmin } from "@/lib/supabase-admin";
import NavBar from "@/components/NavBar";
import SettingsClient from "@/components/SettingsClient";
import { CRON_JOB_AUTO_LINK_IPL, getLastCronJobRun } from "@/lib/cron-job-runs";
import { formatUiDateTime } from "@/lib/ui-time";

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
  const cronRow = await getLastCronJobRun(CRON_JOB_AUTO_LINK_IPL);
  const cronLastRun =
    cronRow == null
      ? null
      : {
          finishedLabel: formatUiDateTime(cronRow.finished_at),
          ok: cronRow.ok,
          linkedCount: typeof cronRow.summary.linkedCount === "number" ? cronRow.summary.linkedCount : null,
          errorCount: typeof cronRow.summary.errorCount === "number" ? cronRow.summary.errorCount : null,
          istDate: typeof cronRow.summary.istDate === "string" ? cronRow.summary.istDate : null,
          errorMessage: typeof cronRow.summary.error === "string" ? cronRow.summary.error : null,
        };

  return (
    <main className="page-main" style={{ maxWidth: 720 }}>
      <NavBar title="Settings" subtitle="Names, scoring, sync & league setup" />
      <SettingsClient settings={settings as any} cronLastRun={cronLastRun} />
    </main>
  );
}
