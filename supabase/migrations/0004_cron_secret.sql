-- Let the scheduler authenticate without anyone pasting a key.
--
-- The first version of this had the cron job read the project's service-role
-- key out of Vault, which meant a setup step that ran
--   select vault.create_secret('<service role key>', 'service_role_key');
-- A placeholder is easy to paste unchanged, and when that happens the job
-- keeps firing and the function keeps answering 401 with nothing in the UI to
-- say so. The secret is generated here instead, so there is no step to get
-- wrong: the job reads it straight from this table and whoop-sync reads it
-- back with the service-role client Supabase injects for it.

create table if not exists public.sync_config (
  id          boolean primary key default true check (id),
  cron_secret text not null default encode(gen_random_bytes(32), 'hex'),
  created_at  timestamptz not null default now()
);

comment on table public.sync_config is
  'Single row. Holds the shared secret the scheduled sync authenticates with.';

-- No policies and no grants: RLS denies everyone, and only the service role,
-- which bypasses it, can read the secret.
alter table public.sync_config enable row level security;
revoke all on public.sync_config from anon, authenticated;

insert into public.sync_config (id) values (true) on conflict (id) do nothing;

create or replace function public.run_whoop_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
  request_id bigint;
begin
  select cron_secret into secret from public.sync_config limit 1;

  if secret is null then
    raise warning 'run_whoop_sync: sync_config is empty; skipping';
    return;
  end if;

  select net.http_post(
    url     := 'https://datihyxdmpshreyifvzn.supabase.co/functions/v1/whoop-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', secret
    ),
    body    := '{}'::jsonb
  ) into request_id;

  raise notice 'run_whoop_sync: dispatched request %', request_id;
end;
$$;

revoke execute on function public.run_whoop_sync() from public, anon, authenticated;

-- The placeholder that was stored under the old scheme is not a credential and
-- is no longer read by anything.
delete from vault.secrets where name = 'service_role_key';
