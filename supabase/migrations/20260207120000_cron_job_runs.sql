-- Last run metadata for scheduled jobs (e.g. Vercel cron auto-link IPL)
create table if not exists cron_job_runs (
  job_id text primary key,
  finished_at timestamp with time zone not null default now(),
  ok boolean not null default true,
  summary jsonb not null default '{}'::jsonb
);
alter table cron_job_runs enable row level security;
