create table if not exists public.rooms (
  code text primary key,
  state jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists rooms_set_updated_at on public.rooms;

create trigger rooms_set_updated_at
before update on public.rooms
for each row
execute function public.set_updated_at();

-- Keepalive: Supabase free tier pauses projects idle 7+ days. Run this once
-- in the Supabase SQL editor so the project always shows activity, independent
-- of whether the app server (Render) is awake.
-- create extension if not exists pg_cron;
-- select cron.schedule('keepalive', '0 0 */3 * *', $$ select 1 $$);
