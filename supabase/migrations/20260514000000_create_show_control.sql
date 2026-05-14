create table if not exists public.show_control (
  id text primary key,
  state text not null check (state in ('WAITING', 'PLAYING', 'STOPPED')),
  start_at timestamptz null,
  updated_at timestamptz not null default now()
);

insert into public.show_control (id, state, start_at, updated_at)
values ('main', 'WAITING', null, now())
on conflict (id) do nothing;

alter table public.show_control enable row level security;

drop policy if exists "show_control_read_for_clients" on public.show_control;

create policy "show_control_read_for_clients"
on public.show_control
for select
to anon, authenticated
using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'show_control'
  ) then
    alter publication supabase_realtime add table public.show_control;
  end if;
end $$;
