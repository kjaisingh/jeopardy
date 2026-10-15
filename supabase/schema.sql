create table if not exists public.rooms (
  code text primary key,
  state jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Room snapshots contain private answers and hashed resume credentials. Only
-- the backend service-role client may access them.
alter table public.rooms enable row level security;
revoke all on table public.rooms from anon, authenticated;

create index if not exists rooms_updated_at_idx on public.rooms (updated_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
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

-- Do not add anon/authenticated policies. The service-role key bypasses RLS
-- and must remain server-only.
