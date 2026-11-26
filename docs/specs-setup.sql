-- BA-ReCard China specialization setup (Supabase), next to the `cards` table
-- of docs/cloud-setup.sql (whose cards_touch() trigger function it reuses).
-- Run once in the project's SQL Editor. Open to the anon / publishable key
-- like `cards`; the app shows it only after its simple login.

create table if not exists public.specs (
  id smallint primary key,
  name text not null,
  -- image data URL (WebP/PNG); null = default badge
  icon text,
  description text not null default '',
  -- [{ "source": "card", "id": "<cards.id>" } | { "source": "unit", "id": <game unit id> }]
  units jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

drop trigger if exists specs_touch on public.specs;
create trigger specs_touch before update on public.specs
  for each row execute function public.cards_touch();

alter table public.specs enable row level security;
drop policy if exists "specs open access" on public.specs;
create policy "specs open access" on public.specs
  for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on public.specs to anon, authenticated;

insert into public.specs (id, name) values
  (1, '重型合成旅'), (2, '空降军'), (3, '专精三'), (4, '专精四'), (5, '专精五'), (6, '专精六')
on conflict (id) do nothing;
