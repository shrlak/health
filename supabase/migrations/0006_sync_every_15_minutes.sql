-- Sync every fifteen minutes instead of every six hours.
--
-- Each run asks Whoop for the last two days only, so it is four API calls
-- against a limit of a hundred a minute -- the cadence is cheap. What it buys
-- is that a workout or a new recovery score shows up while you are still
-- looking at it, rather than up to six hours later.

select cron.schedule('whoop-sync', '*/15 * * * *', 'select public.run_whoop_sync()');

-- At four runs an hour, a log row per run would be ninety-six a day and the
-- import history would be nothing but noise. whoop-sync now records one only
-- when a day arrives that it has not seen before, and this is where it
-- remembers the newest one.
alter table public.whoop_tokens
  add column if not exists last_day date;

comment on column public.whoop_tokens.last_day is
  'Newest day seen by a sync. A run that brings nothing newer is not logged.';

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
    body    := '{}'::jsonb,
    -- pg_net gives up after five seconds by default and records a timeout,
    -- which says nothing about whether the sync worked: the function keeps
    -- running regardless. A longer wait makes net._http_response the honest
    -- record of the run it actually was.
    timeout_milliseconds := 60000
  ) into request_id;
end;
$$;

revoke execute on function public.run_whoop_sync() from public, anon, authenticated;
