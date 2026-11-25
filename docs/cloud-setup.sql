-- BA-ReCard shared online card library (Supabase).
--
-- Run once in the project's SQL Editor. The table is deliberately open: anyone
-- with the page (the anon / publishable key) can list, add, change and delete
-- cards — no accounts. Then put the project URL and anon key in
-- src/cloud/config.ts.

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- nickname of whoever saved the card last (free text, optional)
  author text not null default '',
  unit_id integer,
  -- the card in BA-ReCard's exported-file JSON format
  data jsonb not null,
  -- bumped on every update; the app saves only if it still matches, so two
  -- people editing the same card cannot silently overwrite each other
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.cards_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;

drop trigger if exists cards_touch on public.cards;
create trigger cards_touch before update on public.cards
  for each row execute function public.cards_touch();

alter table public.cards enable row level security;
drop policy if exists "cards open access" on public.cards;
create policy "cards open access" on public.cards
  for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on public.cards to anon, authenticated;
