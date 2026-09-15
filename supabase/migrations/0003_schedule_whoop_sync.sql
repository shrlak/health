-- Scheduled Whoop sync.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

/**
 * Calls the whoop-sync function for every connected account.
 *
 * The service-role key is read from Vault rather than written into the job
 * definition, so it is not sitting in cron.job for anyone with database access
 * to read. Until the secret exists the function exits quietly instead of
 * erroring every few hours and filling the cron log with noise. Create it once
 * with:
 *
 *   select vault.create_secret('<service role key>', 'service_role_key');
 *
 * Note pg_net installs into the `net` schema regardless of the schema given to
 * CREATE EXTENSION.
 */
create or replace function public.run_whoop_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  key text;
  request_id bigint;
begin
  select decrypted_secret into key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  if key is null then
    raise notice 'run_whoop_sync: no service_role_key in vault; skipping';
    return;
  end if;

  select net.http_post(
    url     := 'https://datihyxdmpshreyifvzn.supabase.co/functions/v1/whoop-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || key
    ),
    body    := '{}'::jsonb
  ) into request_id;

  raise notice 'run_whoop_sync: dispatched request %', request_id;
end;
$$;

-- Never reachable over the REST API: this holds a service-role key while it runs.
revoke execute on function public.run_whoop_sync() from public, anon, authenticated;

-- Every six hours rather than nightly, because Whoop finalises a night's
-- scores when you wake and shift work moves that around the clock. Each run is
-- a no-op when there is nothing new.
select cron.unschedule('whoop-sync') where exists (
  select 1 from cron.job where jobname = 'whoop-sync'
);
select cron.schedule('whoop-sync', '7 */6 * * *', 'select public.run_whoop_sync()');
