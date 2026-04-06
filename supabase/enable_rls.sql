-- Run this in the Supabase SQL Editor (once per project) if you already applied schema.sql
-- without RLS. Safe to re-run: enabling RLS twice is a no-op.
--
-- Why: Supabase warns when RLS is off because the anon key can read/write public tables
-- via the Data API. This app only uses SUPABASE_SERVICE_ROLE_KEY on the server, which
-- bypasses RLS — so locking the tables does not break the Next.js app.

alter table if exists series_settings enable row level security;
alter table if exists matches enable row level security;
alter table if exists api_key_stats enable row level security;
alter table if exists competitions enable row level security;
alter table if exists fantasy_players enable row level security;
alter table if exists match_state_snapshots enable row level security;

-- No policies for anon / authenticated: default deny when RLS is on and no policy matches.
-- (Do not publish policies that grant anon access unless you intentionally expose data.)
