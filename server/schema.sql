-- BA-ReCard online library database (PostgreSQL 14+). Run by install.sh as
-- the postgres superuser; running it again keeps all data.
--
-- Roles (cluster-wide names, so they are prefixed):
--   ba_recard_owner          owns the tables and functions (no login)
--   ba_recard_authenticator  PostgREST logs in with it and switches per request to
--   ba_recard_anon           requests without a token: may only call api.login
--                            and api.register
--   ba_recard_editor         requests with a token from api.login/api.register:
--                            reads and writes the cards and specs tables; who it
--                            is (the token's "sub") is private.accounts.username
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
  -- display name of the account that created the card (set by a trigger;
  -- cards from before accounts existed keep the nickname typed back then)
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

-- Custom specializations (the first six rows, ids 1-6, are the China Mod's)
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
-- points per arsenal category, keyed by UnitCategoryType id ("0" recon …
-- "6" aircraft), like the game's Specializations.ReconPoints etc.; {} = unset
-- (added 2026-11-27)
alter table api.specs add column if not exists points jsonb not null default '{}'::jsonb;

-- Custom specializations of any nation (2026-11-27, second change): anyone
-- logged in may add one; ids come from a sequence (the six China rows keep
-- 1-6). faction is the nation or side it belongs to, sort its place in the
-- list, created_by who added it (only they or an admin may delete it).
do $$
begin
  if not exists (select from information_schema.columns
                 where table_schema = 'api' and table_name = 'specs' and column_name = 'faction') then
    alter table api.specs add column faction text not null default '';
    -- the six existing rows are the China Mod's specializations
    update api.specs set faction = '中国';
  end if;
end $$;
alter table api.specs add column if not exists sort integer not null default 0;
alter table api.specs add column if not exists created_by text;
create sequence if not exists api.specs_id_seq as smallint owned by api.specs.id;
select setval('api.specs_id_seq', greatest((select max(id) from api.specs), 6));
alter table api.specs alter column id set default nextval('api.specs_id_seq');

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

-- Accounts. Passwords are bcrypt hashes: people register on the page with an
-- invite code (api.register), or an admin sets one with ba-recard-set-password.
create table if not exists private.accounts (
  username text primary key,
  password_hash text not null,
  updated_at timestamptz not null default now()
);
-- added with registration (2026-11-26)
alter table private.accounts add column if not exists display_name text not null default '';
alter table private.accounts add column if not exists role text not null default 'member';
alter table private.accounts add column if not exists created_at timestamptz not null default now();
-- account names are unique ignoring case
create unique index if not exists accounts_username_ci on private.accounts (lower(username));
-- the original shared account stays, as the administrator
update private.accounts set role = 'admin' where username = 'admin' and role <> 'admin';

-- Invite codes for api.register; max_uses null = unlimited
create table if not exists private.invite_codes (
  code text primary key,
  note text not null default '',
  max_uses integer,
  uses integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into private.invite_codes (code, note) values ('tsumugi', 'first code')
  on conflict (code) do nothing;

-- Who made / last saved a card or specialization, stamped from the login
-- token by triggers (author/editor are display names, *_by are usernames).
alter table api.cards add column if not exists editor text not null default '';
alter table api.cards add column if not exists created_by text;
alter table api.cards add column if not exists updated_by text;
alter table api.specs add column if not exists editor text not null default '';
alter table api.specs add column if not exists updated_by text;

-- the username of the request's login token (null outside PostgREST)
create or replace function private.request_user() returns text
language sql stable set search_path = '' as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json ->> 'sub'
$$;

create or replace function private.display_name(account text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select coalesce(nullif(a.display_name, ''), a.username) from private.accounts a where a.username = account),
    account)
$$;

create or replace function private.stamp_card() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text := private.request_user();
  nick text;
begin
  if who is null then
    return new;
  end if;
  nick := private.display_name(who);
  new.editor := nick;
  new.updated_by := who;
  if tg_op = 'INSERT' then
    new.author := nick;
    new.created_by := who;
  else
    new.author := old.author;
    new.created_by := old.created_by;
  end if;
  return new;
end $$;

create or replace function private.stamp_spec() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text := private.request_user();
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
  end if;
  if who is not null then
    new.editor := private.display_name(who);
    new.updated_by := who;
    if tg_op = 'INSERT' then
      new.created_by := who;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists cards_stamp on api.cards;
create trigger cards_stamp before insert or update on api.cards
  for each row execute function private.stamp_card();
drop trigger if exists specs_stamp on api.specs;
create trigger specs_stamp before insert or update on api.specs
  for each row execute function private.stamp_spec();

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

create or replace function private.session(account text) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'token', private.jwt_sign(json_build_object(
      'role', 'ba_recard_editor', 'sub', a.username,
      'exp', extract(epoch from now() + interval '30 days')::bigint)),
    'expires_at', extract(epoch from now() + interval '30 days')::bigint,
    'username', a.username,
    'display_name', a.display_name,
    'role', a.role)
  from private.accounts a where a.username = account
$$;

-- POST /rpc/login {"username": "...", "password": "..."}
--   -> {"token": "<JWT for ba_recard_editor>", "expires_at": <unix seconds>,
--       "username", "display_name", "role"}
--   wrong account or password -> HTTP 403 (SQLSTATE 28P01)
-- Account names match case-insensitively.
create or replace function api.login(username text, password text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  account text := btrim(coalesce(login.username, ''));
  found_name text;
  stored text;
begin
  select a.username, a.password_hash into found_name, stored
    from private.accounts a where lower(a.username) = lower(account)
    order by a.username = account desc limit 1;
  if stored is null then
    -- same work as a real check, so an unknown account answers as slowly
    perform extensions.crypt(coalesce(login.password, ''), extensions.gen_salt('bf', 10));
    raise exception 'wrong account or password' using errcode = '28P01';
  end if;
  if extensions.crypt(coalesce(login.password, ''), stored) <> stored then
    raise exception 'wrong account or password' using errcode = '28P01';
  end if;
  return private.session(found_name);
end $$;

-- POST /rpc/register {"username", "password", "invite_code", "display_name"}
--   -> same answer as api.login (signed in right away)
--   bad account name -> 400 "username"; password under 6 chars -> 400 "password";
--   unknown/used-up invite code -> 403 "invite"; name taken -> 409 "taken"
-- Invite codes match case-insensitively.
create or replace function api.register(username text, password text, invite_code text, display_name text default '')
returns json
language plpgsql security definer set search_path = '' as $$
declare
  account text := btrim(coalesce(register.username, ''));
  nick text := left(btrim(coalesce(register.display_name, '')), 32);
  given_code text := btrim(coalesce(register.invite_code, ''));
  invite private.invite_codes;
begin
  if account !~ '^[^[:space:][:cntrl:]/\\]{2,24}$' then
    raise sqlstate 'PT400' using message = 'username';
  end if;
  if length(coalesce(register.password, '')) < 6 then
    raise sqlstate 'PT400' using message = 'password';
  end if;
  select * into invite from private.invite_codes c
    where lower(c.code) = lower(given_code) order by c.active desc limit 1 for update;
  if not found or not invite.active or (invite.max_uses is not null and invite.uses >= invite.max_uses) then
    raise sqlstate 'PT403' using message = 'invite';
  end if;
  if exists (select from private.accounts a where lower(a.username) = lower(account)) then
    raise sqlstate 'PT409' using message = 'taken';
  end if;
  insert into private.accounts (username, password_hash, display_name)
    values (account, extensions.crypt(register.password, extensions.gen_salt('bf', 10)), nick);
  update private.invite_codes c set uses = c.uses + 1 where c.code = invite.code;
  return private.session(account);
end $$;

-- POST /rpc/me -> {"username", "display_name", "role"} of the login token
create or replace function api.me() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object('username', a.username, 'display_name', a.display_name, 'role', a.role)
  from private.accounts a where a.username = private.request_user()
$$;

-- POST /rpc/set_display_name {"display_name"} -> same as api.me
create or replace function api.set_display_name(display_name text) returns json
language plpgsql security definer set search_path = '' as $$
begin
  update private.accounts a
    set display_name = left(btrim(coalesce(set_display_name.display_name, '')), 32), updated_at = now()
    where a.username = private.request_user();
  return api.me();
end $$;

-- POST /rpc/change_password {"old_password", "new_password"} -> true
--   wrong old password -> 403; new one under 6 chars -> 400 "password"
create or replace function api.change_password(old_password text, new_password text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  who text := private.request_user();
  stored text;
begin
  select a.password_hash into stored from private.accounts a where a.username = who;
  if stored is null or extensions.crypt(coalesce(change_password.old_password, ''), stored) <> stored then
    raise exception 'wrong password' using errcode = '28P01';
  end if;
  if length(coalesce(change_password.new_password, '')) < 6 then
    raise sqlstate 'PT400' using message = 'password';
  end if;
  update private.accounts a
    set password_hash = extensions.crypt(change_password.new_password, extensions.gen_salt('bf', 10)), updated_at = now()
    where a.username = who;
  return true;
end $$;

create or replace function private.is_admin(account text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select from private.accounts a where a.username = account and a.role = 'admin')
$$;

-- Only the card's creator or an admin may delete it (cards from before
-- accounts existed have no creator: only an admin)
create or replace function private.guard_card_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text := private.request_user();
begin
  if who is not null and old.created_by is distinct from who and not private.is_admin(who) then
    raise sqlstate 'PT403' using message = 'not_owner';
  end if;
  return old;
end $$;

drop trigger if exists cards_guard_delete on api.cards;
create trigger cards_guard_delete before delete on api.cards
  for each row execute function private.guard_card_delete();

-- the same for specializations (the six original ones: only an admin)
drop trigger if exists specs_guard_delete on api.specs;
create trigger specs_guard_delete before delete on api.specs
  for each row execute function private.guard_card_delete();

-- the units entry of an online card in api.specs.units
create or replace function private.is_card_ref(entry jsonb, card text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(entry ->> 'source' = 'card' and lower(entry ->> 'id') = lower(card), false)
$$;

create or replace function private.drop_card_ref(units jsonb, card text) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(e.u order by e.ord), '[]'::jsonb)
  from jsonb_array_elements(units) with ordinality as e(u, ord)
  where not private.is_card_ref(e.u, card)
$$;

-- a deleted card leaves the specializations it was in
create or replace function private.unlink_card() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update api.specs s set units = private.drop_card_ref(s.units, old.id::text)
    where exists (select from jsonb_array_elements(s.units) as x(u) where private.is_card_ref(x.u, old.id::text));
  return old;
end $$;

drop trigger if exists cards_unlink on api.cards;
create trigger cards_unlink after delete on api.cards
  for each row execute function private.unlink_card();

-- POST /rpc/set_card_specs {"card_id": "<uuid>", "spec_ids": [1, 3]}
--   puts an online card into exactly these specializations ([] = none): it is
--   appended to the ones it is new to and keeps its place in the others.
--   -> [{"id", "version"}] of every specialization afterwards
--   unknown card -> 404 "card"
create or replace function api.set_card_specs(card_id uuid, spec_ids integer[]) returns json
language plpgsql security definer set search_path = '' as $$
declare
  wanted integer[] := coalesce(set_card_specs.spec_ids, '{}');
  card text := set_card_specs.card_id::text;
begin
  if not exists (select from api.cards c where c.id = set_card_specs.card_id) then
    raise sqlstate 'PT404' using message = 'card';
  end if;
  update api.specs s set units = private.drop_card_ref(s.units, card)
    where s.id <> all(wanted)
      and exists (select from jsonb_array_elements(s.units) as x(u) where private.is_card_ref(x.u, card));
  update api.specs s set units = s.units || jsonb_build_array(jsonb_build_object('source', 'card', 'id', card))
    where s.id = any(wanted)
      and not exists (select from jsonb_array_elements(s.units) as x(u) where private.is_card_ref(x.u, card));
  return (select coalesce(json_agg(json_build_object('id', s.id, 'version', s.version) order by s.id), '[]'::json)
          from api.specs s);
end $$;

-- Admin pages. Each raises 403 "admin" for a non-admin.
create or replace function private.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin(private.request_user()) then
    raise sqlstate 'PT403' using message = 'admin';
  end if;
end $$;

create or replace function private.overview() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  return json_build_object(
    'accounts', (select coalesce(json_agg(json_build_object(
        'username', a.username, 'display_name', a.display_name, 'role', a.role,
        'created_at', a.created_at) order by a.created_at, a.username), '[]'::json)
      from private.accounts a),
    'invites', (select coalesce(json_agg(json_build_object(
        'code', c.code, 'uses', c.uses, 'max_uses', c.max_uses, 'active', c.active,
        'created_at', c.created_at) order by c.active desc, c.created_at desc), '[]'::json)
      from private.invite_codes c));
end $$;

-- POST /rpc/admin_overview -> {"accounts": [...], "invites": [...]}
create or replace function api.admin_overview() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return private.overview();
end $$;

-- POST /rpc/admin_set_invite_code {"code"}: this becomes the one invite code
-- that works (the others are switched off, not deleted) -> admin_overview
--   code shorter than 4 or longer than 64 chars -> 400 "code"
create or replace function api.admin_set_invite_code(code text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  new_code text := btrim(coalesce(admin_set_invite_code.code, ''));
begin
  perform private.require_admin();
  if length(new_code) < 4 or length(new_code) > 64 then
    raise sqlstate 'PT400' using message = 'code';
  end if;
  update private.invite_codes c set active = (lower(c.code) = lower(new_code))
    where c.active or lower(c.code) = lower(new_code);
  insert into private.invite_codes (code) select new_code
    where not exists (select from private.invite_codes c where lower(c.code) = lower(new_code));
  return private.overview();
end $$;

-- POST /rpc/admin_reset_password {"username", "new_password"} -> true
--   new password under 6 chars -> 400 "password"; unknown account -> 404 "account"
create or replace function api.admin_reset_password(username text, new_password text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if length(coalesce(admin_reset_password.new_password, '')) < 6 then
    raise sqlstate 'PT400' using message = 'password';
  end if;
  update private.accounts a
    set password_hash = extensions.crypt(admin_reset_password.new_password, extensions.gen_salt('bf', 10)), updated_at = now()
    where a.username = admin_reset_password.username;
  if not found then
    raise sqlstate 'PT404' using message = 'account';
  end if;
  return true;
end $$;

-- POST /rpc/admin_set_role {"username", "role": "admin" | "member"} -> admin_overview
--   the last admin cannot be made a member -> 409 "last_admin"
create or replace function api.admin_set_role(username text, role text) returns json
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if admin_set_role.role not in ('admin', 'member') then
    raise sqlstate 'PT400' using message = 'role';
  end if;
  if admin_set_role.role = 'member'
     and not exists (select from private.accounts a
                     where a.role = 'admin' and a.username <> admin_set_role.username) then
    raise sqlstate 'PT409' using message = 'last_admin';
  end if;
  update private.accounts a set role = admin_set_role.role, updated_at = now()
    where a.username = admin_set_role.username;
  if not found then
    raise sqlstate 'PT404' using message = 'account';
  end if;
  return private.overview();
end $$;

reset role;

-- Privileges: nothing for anyone by default ...
revoke all on all functions in schema api, private from public;
alter default privileges for role ba_recard_owner revoke execute on functions from public;
revoke all on all tables in schema api, private from public;

-- ... then exactly what each request role needs
grant usage on schema api to ba_recard_anon, ba_recard_editor;
grant execute on function api.login(text, text) to ba_recard_anon, ba_recard_editor;
grant execute on function api.register(text, text, text, text) to ba_recard_anon, ba_recard_editor;
grant execute on function api.me(), api.set_display_name(text), api.change_password(text, text),
  api.set_card_specs(uuid, integer[]), api.admin_overview(), api.admin_set_invite_code(text),
  api.admin_reset_password(text, text), api.admin_set_role(text, text)
  to ba_recard_editor;
grant select, insert, update, delete on api.cards, api.specs to ba_recard_editor;
grant usage on sequence api.specs_id_seq to ba_recard_editor;

-- let a running PostgREST pick up the changes
notify pgrst, 'reload schema';
