create table if not exists series_settings (
  id bigint generated always as identity primary key,
  your_name text not null default 'You',
  opponent_name text not null default 'Rahul'
);

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

-- Rename trump → captain (safe to run multiple times; errors if already renamed are fine)
do $$ begin
  alter table fantasy_players rename column trump to captain;
exception when undefined_column then null; end $$;

create table if not exists fantasy_players (
  id bigint generated always as identity primary key,
  match_id bigint not null references matches(id) on delete cascade,
  side text not null check (side in ('You', 'Rahul')),
  name text not null,
  captain boolean not null default false,
  runs integer not null default 0,
  wickets integer not null default 0,
  catches integer not null default 0,
  fifty_bonus integer not null default 0,
  hundred_bonus integer not null default 0,
  three_w_bonus integer not null default 0,
  five_w_bonus integer not null default 0,
  mom_bonus integer not null default 0,
  unique(match_id, name)
);
