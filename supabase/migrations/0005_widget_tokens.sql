-- Read-only tokens, for the Mac widget.
--
-- The widget cannot hold a Supabase session -- it wakes on WidgetKit's
-- schedule, long after any JWT would have expired -- so it authenticates with
-- a long-lived bearer token, the same hash-only scheme the push endpoint uses.
--
-- A widget only ever reads, so it gets a token that can only read. Splitting
-- the scopes means a token copied out of a laptop cannot be turned around and
-- used to write health data.

alter table public.ingest_tokens
  add column if not exists scope text not null default 'ingest';

alter table public.ingest_tokens drop constraint if exists ingest_tokens_scope_check;
alter table public.ingest_tokens
  add constraint ingest_tokens_scope_check check (scope in ('ingest', 'read'));

comment on column public.ingest_tokens.scope is
  '''ingest'' may write health data; ''read'' may only read the summary.';
