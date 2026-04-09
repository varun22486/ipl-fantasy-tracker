import { supabaseAdmin } from "@/lib/supabase-admin";

export const CRON_JOB_AUTO_LINK_IPL = "auto-link-ipl";

export type CronJobRunRow = {
  job_id: string;
  finished_at: string;
  ok: boolean;
  summary: Record<string, unknown>;
};

/** Best-effort: failures are logged; missing table should not break cron. */
export async function recordCronJobRun(
  jobId: string,
  ok: boolean,
  summary: Record<string, unknown>
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("cron_job_runs").upsert(
      {
        job_id: jobId,
        finished_at: new Date().toISOString(),
        ok,
        summary,
      },
      { onConflict: "job_id" }
    );
    if (error) console.error("[cron_job_runs] upsert:", error.message);
  } catch (e) {
    console.error("[cron_job_runs]", e);
  }
}

export async function getLastCronJobRun(jobId: string): Promise<CronJobRunRow | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("cron_job_runs")
      .select("job_id, finished_at, ok, summary")
      .eq("job_id", jobId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      job_id: String(data.job_id),
      finished_at: String(data.finished_at),
      ok: Boolean(data.ok),
      summary: (data.summary && typeof data.summary === "object" ? data.summary : {}) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}
