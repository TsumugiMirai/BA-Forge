-- BA-ReCard online library database (PostgreSQL 14+). Run by install.sh as
-- the postgres superuser; running it again keeps all data.
--
-- Roles (cluster-wide names, so they are prefixed):
--   ba_recard_owner          owns the tables and functions (no login)
--   ba_recard_authenticator  PostgREST logs in with it and switches per request to
--   ba_recard_anon           requests without a token: may only call api.login
--   ba_recard_editor         requests with a token from api.login: reads and writes
--                            the cards and specs tables
--
-- psql variables set by install.sh: auth_password, jwt_secret

\set ON_ERROR_STOP on

do $$
begin
  if not exists (select from pg_roles where rolname = 'ba_recard_owner') then
    create role ba_recard_owner nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'ba_recard_authenticator') then
    create role ba_recard_authenticator login noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'ba_recard_anon') then
    create role ba_recard_anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'ba_recard_editor') then
    create role ba_recard_editor nologin;
  end if;
end $$;

alter role ba_recard_authenticator with login noinherit password :'auth_password';
grant ba_recard_anon, ba_recard_editor to ba_recard_authenticator;

select 'create database ba_recard owner ba_recard_owner'
where not exists (select from pg_database where datname = 'ba_recard') \gexec

\connect ba_recard

revoke all on database ba_recard from public;
grant connect on database ba_recard to ba_recard_authenticator;
revoke all on schema public from public;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to ba_recard_owner;

-- api: what PostgREST serves (db-schemas); private: never served
create schema if not exists api authorization ba_recard_owner;
create schema if not exists private authorization ba_recard_owner;

set role ba_recard_owner;

-- Online card library (same columns as the former Supabase table)
create table if not exists api.cards (
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

-- China specialization setup (six rows, ids 1-6)
create table if not exists api.specs (
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

create or replace function private.touch_row() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;

drop trigger if exists cards_touch on api.cards;
create trigger cards_touch before update on api.cards
  for each row execute function private.touch_row();
drop trigger if exists specs_touch on api.specs;
create trigger specs_touch before update on api.specs
  for each row execute function private.touch_row();

-- The shared page account(s). Passwords are bcrypt hashes; set them with
-- ba-recard-set-password, never by hand.
create table if not exists private.accounts (
  username text primary key,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

-- jwt_secret: the HS256 key api.login signs tokens with; PostgREST checks
-- them with the same key (jwt-secret in /etc/ba-recard/postgrest.conf)
create table if not exists private.settings (
  key text primary key,
  value text not null
);
insert into private.settings (key, value) values ('jwt_secret', :'jwt_secret')
  on conflict (key) do update set value = excluded.value;

create or replace function private.base64url(data bytea) returns text
language sql immutable strict set search_path = '' as $$
  select rtrim(translate(encode(data, 'base64'), E'+/\n', '-_'), '=')
$$;

create or replace function private.jwt_sign(claims json) returns text
language plpgsql stable set search_path = '' as $$
declare
  secret text;
  signing_input text;
begin
  select s.value into strict secret from private.settings s where s.key = 'jwt_secret';
  signing_input := private.base64url(convert_to('{"alg":"HS256","typ":"JWT"}', 'utf8'))
    || '.' || private.base64url(convert_to(claims::text, 'utf8'));
  return signing_input || '.' || private.base64url(
    extensions.hmac(convert_to(signing_input, 'utf8'), convert_to(secret, 'utf8'), 'sha256'));
end $$;

-- POST /rpc/login {"username": "...", "password": "..."}
--   -> {"token": "<JWT for ba_recard_editor>", "expires_at": <unix seconds>}
--   wrong account or password -> HTTP 403 (SQLSTATE 28P01)
create or replace function api.login(username text, password text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  account text := btrim(coalesce(login.username, ''));
  stored text;
  expires bigint := extract(epoch from now() + interval '30 days')::bigint;
begin
  select a.password_hash into stored from private.accounts a where a.username = account;
  if stored is null then
    -- same work as a real check, so an unknown account answers as slowly
    perform extensions.crypt(coalesce(login.password, ''), extensions.gen_salt('bf', 10));
    raise exception 'wrong account or password' using errcode = '28P01';
  end if;
  if extensions.crypt(coalesce(login.password, ''), stored) <> stored then
    raise exception 'wrong account or password' using errcode = '28P01';
  end if;
  return json_build_object(
    'token', private.jwt_sign(json_build_object('role', 'ba_recard_editor', 'sub', account, 'exp', expires)),
    'expires_at', expires);
end $$;

reset role;

-- Privileges: nothing for anyone by default ...
revoke all on all functions in schema api, private from public;
alter default privileges for role ba_recard_owner revoke execute on functions from public;
revoke all on all tables in schema api, private from public;

-- ... then exactly what each request role needs
grant usage on schema api to ba_recard_anon, ba_recard_editor;
grant execute on function api.login(text, text) to ba_recard_anon, ba_recard_editor;
grant select, insert, update, delete on api.cards, api.specs to ba_recard_editor;

-- let a running PostgREST pick up the changes
notify pgrst, 'reload schema';
