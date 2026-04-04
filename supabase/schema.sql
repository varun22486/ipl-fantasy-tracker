create table if not exists series_settings (
  id bigint generated always as identity primary key,
  your_name text not null default 'You',
  opponent_name text not null default 'Rahul',
  pts_run integer not null default 1,
  pts_wicket integer not null default 20,
  pts_catch integer not null default 10,
  pts_runout integer not null default 10,
  pts_stump integer not null default 10,
  pts_fifty integer not null default 10,
  pts_hundred integer not null default 20,
  pts_three_w integer not null default 10,
  pts_five_w integer not null default 20,
  pts_mom integer not null default 10
);

-- Add scoring columns if upgrading an existing DB
alter table series_settings add column if not exists your_name text not null default 'You';
alter table series_settings add column if not exists pts_run integer not null default 1;
alter table series_settings add column if not exists pts_wicket integer not null default 20;
alter table series_settings add column if not exists pts_catch integer not null default 10;
alter table series_settings add column if not exists pts_runout integer not null default 10;
alter table series_settings add column if not exists pts_stump integer not null default 10;
alter table series_settings add column if not exists pts_fifty integer not null default 10;
alter table series_settings add column if not exists pts_hundred integer not null default 20;
alter table series_settings add column if not exists pts_three_w integer not null default 10;
alter table series_settings add column if not exists pts_five_w integer not null default 20;
alter table series_settings add column if not exists pts_mom integer not null default 10;

insert into series_settings (your_name, opponent_name)
select 'You', 'Rahul'
where not exists (select 1 from series_settings);

create table if not exists matches (
  id bigint generated always as identity primary key,
  external_match_id text,
  match_date date not null,
  label text not null unique,
  fixture text not null,
  venue text,
  toss_winner text,
  status text not null default 'DRAFT',
  live_summary text,
  source_url text,
  auto_sync boolean not null default true,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

alter table matches add column if not exists external_match_id text;
alter table matches add column if not exists live_summary text;
alter table matches add column if not exists source_url text;
alter table matches add column if not exists auto_sync boolean not null default true;
alter table matches add column if not exists last_synced_at timestamp with time zone;
alter table matches add column if not exists provider_squad_json jsonb;
alter table matches add column if not exists is_current boolean not null default false;

-- API key hit tracking (one row per key per day)
create table if not exists api_key_stats (
  key_alias text not null,
  stat_date date not null default current_date,
  hits integer not null default 0,
  last_used_at timestamp with time zone default now(),
  -- Temporary 15-min rate-limit block; null means not blocked
  rate_limited_until timestamp with time zone,
  -- Date on which this key's daily quota was exhausted; null means not exhausted
  quota_exhausted_at date,
  primary key (key_alias, stat_date)
);

-- Add block-tracking columns to existing tables (safe to re-run)
alter table api_key_stats add column if not exists rate_limited_until timestamp with time zone;
alter table api_key_stats add column if not exists quota_exhausted_at date;

-- Upsert function used by the backend to increment per-key counters
create or replace function increment_key_hit(p_alias text, p_date date)
returns void language plpgsql as $$
begin
  insert into api_key_stats (key_alias, stat_date, hits, last_used_at)
  values (p_alias, p_date, 1, now())
  on conflict (key_alias, stat_date)
  do update set hits = api_key_stats.hits + 1, last_used_at = now();
end;
$$;

-- Record a 15-min rate-limit block on a key
create or replace function mark_key_rate_limited(p_alias text, p_until timestamp with time zone)
returns void language plpgsql as $$
begin
  insert into api_key_stats (key_alias, stat_date, hits, rate_limited_until)
  values (p_alias, current_date, 0, p_until)
  on conflict (key_alias, stat_date)
  do update set rate_limited_until = p_until;
end;
$$;

-- Record that a key's daily quota is exhausted
create or replace function mark_key_quota_exhausted(p_alias text, p_date date)
returns void language plpgsql as $$
begin
  insert into api_key_stats (key_alias, stat_date, hits, quota_exhausted_at)
  values (p_alias, p_date, 0, p_date)
  on conflict (key_alias, stat_date)
  do update set quota_exhausted_at = p_date;
end;
$$;

-- ── Competitions (multiple head-to-head pairs) ───────────────────────────────
create table if not exists competitions (
  id bigint generated always as identity primary key,
  name text not null default 'Main',
  player1_name text not null,  -- kept for backward compat, = players[0]
  player2_name text not null,  -- kept for backward compat, = players[1]
  players jsonb,               -- ["Alice","Bob","Charlie",...] — full participant list
  created_at timestamp with time zone default now()
);

-- Migrate existing 2-player competitions to have a players array
alter table competitions add column if not exists players jsonb;
update competitions set players = jsonb_build_array(player1_name, player2_name) where players is null;

-- Add competition scope to fantasy players
alter table fantasy_players add column if not exists competition_id bigint references competitions(id) on delete cascade;

-- When you run this for the first time, create the default competition from series_settings
-- and migrate existing player rows to it:
-- INSERT INTO competitions (name, player1_name, player2_name)
--   SELECT 'Main', your_name, opponent_name FROM series_settings LIMIT 1;
-- Then: UPDATE fantasy_players SET competition_id = <id above> WHERE competition_id IS NULL;

-- ── End competitions ──────────────────────────────────────────────────────────

-- Rename trump → captain (safe to run multiple times; errors if already renamed are fine)
do $$ begin
  alter table fantasy_players rename column trump to captain;
exception when undefined_column then null; end $$;

create table if not exists fantasy_players (
  id bigint generated always as identity primary key,
  match_id bigint not null references matches(id) on delete cascade,
  side text not null,
  name text not null,
  captain boolean not null default false,
  runs integer not null default 0,
  wickets integer not null default 0,
  catches integer not null default 0,
  runouts integer not null default 0,
  stumpings integer not null default 0,
  fifty_bonus integer not null default 0,
  hundred_bonus integer not null default 0,
  three_w_bonus integer not null default 0,
  five_w_bonus integer not null default 0,
  mom_bonus integer not null default 0,
  /** CricAPI player UUID — used for reliable ID-based sync matching */
  provider_player_id text,
  bench boolean not null default false
  -- uniqueness enforced by partial indexes below
);

-- Allow same player in different competitions, but still unique within one competition.
-- Default competition (competition_id IS NULL): one row per player per match.
-- Named competition: one row per player per (match + competition).
-- These replace the old unique(match_id, name) which blocked cross-competition picks.
create unique index if not exists fp_default_unique
  on fantasy_players (match_id, name) where competition_id is null;

create unique index if not exists fp_named_unique
  on fantasy_players (match_id, name, competition_id) where competition_id is not null;

-- Migration for existing DBs: drop old constraint and create partial indexes
-- Run in Supabase SQL editor:
-- ALTER TABLE fantasy_players DROP CONSTRAINT IF EXISTS fantasy_players_match_id_name_key;
-- CREATE UNIQUE INDEX IF NOT EXISTS fp_default_unique ON fantasy_players (match_id, name) WHERE competition_id IS NULL;
-- CREATE UNIQUE INDEX IF NOT EXISTS fp_named_unique ON fantasy_players (match_id, name, competition_id) WHERE competition_id IS NOT NULL;
alter table fantasy_players add column if not exists provider_player_id text;
alter table fantasy_players add column if not exists runouts integer not null default 0;
alter table fantasy_players add column if not exists stumpings integer not null default 0;
alter table fantasy_players add column if not exists bench boolean not null default false;

-- Remove the hardcoded 'Rahul' constraint so any opponent name works
-- (safe to run multiple times — drops only if the constraint exists)
do $$ begin
  alter table fantasy_players drop constraint if exists fantasy_players_side_check;
exception when others then null; end $$;

-- ── Row Level Security (Data API) ─────────────────────────────────────────────
-- The app uses only the service role on the server; it bypasses RLS. Enabling RLS
-- stops anonymous clients from reading/writing these tables via PostgREST.
alter table series_settings enable row level security;
alter table matches enable row level security;
alter table api_key_stats enable row level security;
alter table competitions enable row level security;
alter table fantasy_players enable row level security;
