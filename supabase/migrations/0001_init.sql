-- Personal health dashboard schema
-- Sources: Apple Health (export.xml), Whoop (CSV export + API)

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  display_name text,
  timezone    text not null default 'America/New_York',
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- imports
create table public.imports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  source      text not null check (source in ('apple_health','whoop_csv','whoop_api')),
  filename    text,
  status      text not null default 'running' check (status in ('running','complete','error')),
  rows_imported integer not null default 0,
  range_start date,
  range_end   date,
  error       text,
  created_at  timestamptz not null default now(),
  completed_at timestamptz
);
create index imports_user_created_idx on public.imports (user_id, created_at desc);

-- ------------------------------------------------------- daily_metrics
-- Long/EAV format: one row per (day, metric, source). Keeps Apple Health's
-- open-ended metric vocabulary from forcing a migration per new data type.
create table public.daily_metrics (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  metric  text not null,
  source  text not null,
  value   double precision not null,
  unit    text,
  primary key (user_id, day, metric, source)
);
create index daily_metrics_lookup_idx on public.daily_metrics (user_id, metric, day desc);

-- ------------------------------------------------------ sleep_sessions
create table public.sleep_sessions (
  user_id     uuid not null references auth.users(id) on delete cascade,
  source      text not null,
  external_id text not null,
  day         date not null,            -- the night this sleep is attributed to
  started_at  timestamptz not null,
  ended_at    timestamptz not null,
  is_nap      boolean not null default false,
  duration_min      double precision,
  asleep_min        double precision,
  rem_min           double precision,
  deep_min          double precision,
  light_min         double precision,
  awake_min         double precision,
  latency_min       double precision,
  efficiency_pct    double precision,
  disturbances      integer,
  respiratory_rate  double precision,
  performance_pct   double precision,
  need_min          double precision,
  debt_min          double precision,
  primary key (user_id, source, external_id)
);
create index sleep_sessions_day_idx on public.sleep_sessions (user_id, day desc);

-- ------------------------------------------------------------ recovery
create table public.recovery (
  user_id        uuid not null references auth.users(id) on delete cascade,
  day            date not null,
  source         text not null,
  recovery_pct   double precision,
  hrv_ms         double precision,
  resting_hr     double precision,
  spo2_pct       double precision,
  skin_temp_c    double precision,
  respiratory_rate double precision,
  primary key (user_id, day, source)
);
create index recovery_day_idx on public.recovery (user_id, day desc);

-- -------------------------------------------------------------- cycles
-- Whoop physiological cycles (day strain)
create table public.cycles (
  user_id     uuid not null references auth.users(id) on delete cascade,
  day         date not null,
  source      text not null,
  strain      double precision,
  avg_hr      double precision,
  max_hr      double precision,
  kilojoules  double precision,
  primary key (user_id, day, source)
);
create index cycles_day_idx on public.cycles (user_id, day desc);

-- ------------------------------------------------------------ workouts
create table public.workouts (
  user_id      uuid not null references auth.users(id) on delete cascade,
  source       text not null,
  external_id  text not null,
  day          date not null,
  started_at   timestamptz not null,
  ended_at     timestamptz not null,
  activity     text,
  duration_min double precision,
  energy_kcal  double precision,
  distance_km  double precision,
  avg_hr       double precision,
  max_hr       double precision,
  strain       double precision,
  zone_1_min   double precision,
  zone_2_min   double precision,
  zone_3_min   double precision,
  zone_4_min   double precision,
  zone_5_min   double precision,
  primary key (user_id, source, external_id)
);
create index workouts_day_idx on public.workouts (user_id, day desc);

-- -------------------------------------------------------- whoop_tokens
-- Phase 2: OAuth refresh tokens for automatic Whoop sync.
create table public.whoop_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  scope         text,
  updated_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------- RLS
alter table public.profiles       enable row level security;
alter table public.imports        enable row level security;
alter table public.daily_metrics  enable row level security;
alter table public.sleep_sessions enable row level security;
alter table public.recovery       enable row level security;
alter table public.cycles         enable row level security;
alter table public.workouts       enable row level security;
alter table public.whoop_tokens   enable row level security;

create policy "own profile" on public.profiles
  for all to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "own imports" on public.imports
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "own daily_metrics" on public.daily_metrics
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "own sleep_sessions" on public.sleep_sessions
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "own recovery" on public.recovery
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "own cycles" on public.cycles
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "own workouts" on public.workouts
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "own whoop_tokens" on public.whoop_tokens
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- handle_new_user() is a trigger function and should never be reachable as a
-- PostgREST RPC. It runs SECURITY DEFINER, so leaving EXECUTE open to the anon
-- and authenticated roles would expose it on /rest/v1/rpc for no reason.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
