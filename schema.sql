-- Run this in the Supabase SQL editor for your project.
-- Everything lives in its own "coaches_clock" schema so it can safely
-- coexist alongside other apps (e.g. OKXCRankings) in the same project
-- without any table name collisions.

create extension if not exists "pgcrypto";

create schema if not exists coaches_clock;

-- A coach's persistent roster, reused across every race all season
create table coaches_clock.team_athletes (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references auth.users(id) not null,
  name text not null,
  bib text,
  created_at timestamptz default now()
);

create table coaches_clock.races (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references auth.users(id) not null,
  name text not null,
  status text default 'setup', -- 'setup' | 'live' | 'finished'
  created_at timestamptz default now()
);

-- The specific set of athletes competing in one race, in expected finish order.
-- team_athlete_id links back to the persistent roster; it's nullable so a
-- one-off runner not on the saved roster can still be added for just this race.
create table coaches_clock.athletes (
  id uuid primary key default gen_random_uuid(),
  race_id uuid references coaches_clock.races(id) on delete cascade not null,
  team_athlete_id uuid references coaches_clock.team_athletes(id) on delete set null,
  name text not null,
  bib text,
  sort_order int not null,
  created_at timestamptz default now()
);

create table coaches_clock.splits (
  id uuid primary key default gen_random_uuid(),
  race_id uuid references coaches_clock.races(id) on delete cascade not null,
  athlete_id uuid references coaches_clock.athletes(id) on delete set null,
  label text,
  recorded_time_ms bigint not null,
  created_at timestamptz default now()
);

alter table coaches_clock.team_athletes enable row level security;
alter table coaches_clock.races enable row level security;
alter table coaches_clock.athletes enable row level security;
alter table coaches_clock.splits enable row level security;

-- Race-facing tables stay publicly readable so results pages are shareable without login
create policy "races viewable by everyone" on coaches_clock.races for select using (true);
create policy "athletes viewable by everyone" on coaches_clock.athletes for select using (true);
create policy "splits viewable by everyone" on coaches_clock.splits for select using (true);

-- Team roster is private to the coach who owns it
create policy "coaches manage own roster" on coaches_clock.team_athletes for all using (auth.uid() = coach_id);

create policy "coaches manage own races" on coaches_clock.races for all using (auth.uid() = coach_id);

create policy "coaches manage own race athletes" on coaches_clock.athletes for all using (
  exists (select 1 from coaches_clock.races where races.id = athletes.race_id and races.coach_id = auth.uid())
);

create policy "coaches manage own race splits" on coaches_clock.splits for all using (
  exists (select 1 from coaches_clock.races where races.id = splits.race_id and races.coach_id = auth.uid())
);

-- Enable realtime so results pages update live as splits are recorded
alter publication supabase_realtime add table coaches_clock.athletes;
alter publication supabase_realtime add table coaches_clock.splits;

-- IMPORTANT: after running this, go to Project Settings -> API -> Exposed schemas
-- in the Supabase dashboard and add "coaches_clock" to the list. Supabase only
-- serves the "public" schema over the API by default; without this step the
-- app's requests will fail with a "schema not found" error.
