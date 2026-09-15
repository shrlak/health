-- Automatic collection from Whoop (pull) and Apple Health (push).

-- ---------------------------------------------------------- whoop tokens
-- The original table only held the token pair; automated sync needs to know
-- how far it has caught up and why it last failed.
alter table public.whoop_tokens
  add column if not exists whoop_user_id text,
  add column if not exists connected_at timestamptz not null default now(),
  add column if not exists last_sync_at timestamptz,
  add column if not exists last_sync_status text,
  add column if not exists last_error text,
  add column if not exists rows_last_sync integer not null default 0;

-- ------------------------------------------------------------ oauth state
-- One-time CSRF state for the Whoop authorization round trip. The callback
-- arrives without a session, so this is what ties the redirect back to a user.
create table if not exists public.oauth_states (
  state       text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  provider    text not null default 'whoop',
  redirect_to text,
  created_at  timestamptz not null default now()
);
create index if not exists oauth_states_created_idx on public.oauth_states (created_at);

-- --------------------------------------------------------- ingest tokens
-- Apple Health has no cloud API, so a device-side agent pushes to us instead.
-- It cannot hold a Supabase session, so it authenticates with a bearer token
-- issued here. Only the hash is stored: a leaked database row must not yield
-- a working credential.
create table if not exists public.ingest_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token_hash   text not null unique,
  -- First few characters, so the UI can identify a token it can no longer show.
  token_hint   text not null,
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists ingest_tokens_user_idx on public.ingest_tokens (user_id);
create index if not exists ingest_tokens_hash_idx on public.ingest_tokens (token_hash)
  where revoked_at is null;

alter table public.oauth_states  enable row level security;
alter table public.ingest_tokens enable row level security;

create policy "own oauth_states" on public.oauth_states
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Deliberately no INSERT policy: tokens are minted by the Edge Function under
-- the service role, so a compromised browser session cannot forge one.
create policy "own ingest_tokens read" on public.ingest_tokens
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own ingest_tokens revoke" on public.ingest_tokens
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 'apple_api' joins the existing source vocabulary for pushed Apple data.
alter table public.imports drop constraint if exists imports_source_check;
alter table public.imports add constraint imports_source_check
  check (source in ('apple_health','whoop_csv','whoop_api','apple_api'));
