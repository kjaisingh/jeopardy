-- Apply after schema.sql. The public row contains no application data.
create table if not exists public.keepalive (
  id smallint primary key check (id = 1)
);

insert into public.keepalive (id) values (1) on conflict do nothing;

alter table public.keepalive enable row level security;
revoke all on table public.keepalive from public, anon, authenticated;
grant select on table public.keepalive to anon;

drop policy if exists keepalive_anon_read on public.keepalive;
create policy keepalive_anon_read on public.keepalive
  for select to anon using (id = 1);
