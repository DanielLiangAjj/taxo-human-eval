-- Outcome taxonomy human evaluation: database for the rating site.
-- Paste this whole file into the Supabase SQL editor and press Run, once.
-- (Running it again is harmless: tables are created only if missing and functions are replaced.)
--
-- Visitors use the public anon key. Row-level security is on and there are no policies, and the table
-- privileges are revoked, so visitors can never read or write the tables directly. The four
-- SECURITY DEFINER functions at the bottom are the only door; each one checks its inputs.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table if not exists public.evaluators (
  code         text primary key,
  name         text not null,
  email        text not null,
  user_agent   text,
  created_at   timestamptz default now(),
  last_seen    timestamptz,
  completed_at timestamptz
);

create table if not exists public.ratings (
  id          bigserial primary key,
  code        text not null references public.evaluators (code),
  sheet       text not null,
  item_id     text not null,
  answer      jsonb not null,
  elapsed_ms  integer,
  client_ts   timestamptz,
  app_version text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (code, sheet, item_id)
);

alter table public.evaluators enable row level security;
alter table public.ratings enable row level security;
-- No policies on purpose: anon and authenticated get no rows and can change nothing.
revoke all on table public.evaluators from anon, authenticated;
revoke all on table public.ratings from anon, authenticated;
revoke all on sequence public.ratings_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- register_evaluator: create the evaluator, or update name, email and last_seen for a known code.
-- ---------------------------------------------------------------------------------------------
create or replace function public.register_evaluator(
  p_code text,
  p_name text,
  p_email text,
  p_user_agent text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_code is null or p_code !~ '^[0-9A-HJKMNP-TV-Z]{10}$' then
    raise exception 'invalid code';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 2 and 80 then
    raise exception 'invalid name';
  end if;
  if p_email is null or char_length(btrim(p_email)) not between 3 and 254
     or btrim(p_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email';
  end if;

  insert into public.evaluators (code, name, email, user_agent, last_seen)
  values (p_code, btrim(p_name), btrim(p_email), left(p_user_agent, 500), now())
  on conflict (code) do update
    set name = excluded.name,
        email = excluded.email,
        last_seen = now();
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- save_rating: upsert one answer; when the row exists, keep whichever has the later client_ts.
-- ---------------------------------------------------------------------------------------------
create or replace function public.save_rating(
  p_code text,
  p_sheet text,
  p_item_id text,
  p_answer jsonb,
  p_elapsed_ms integer,
  p_client_ts timestamptz,
  p_app_version text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_code is null or p_code !~ '^[0-9A-HJKMNP-TV-Z]{10}$' then
    raise exception 'invalid code';
  end if;
  if p_sheet is null or p_sheet not in ('links', 'pairs', 'groups', 'coverage') then
    raise exception 'invalid sheet';
  end if;
  if p_item_id is null or char_length(p_item_id) not between 1 and 10 then
    raise exception 'invalid item id';
  end if;
  if p_answer is null or jsonb_typeof(p_answer) <> 'object' or pg_column_size(p_answer) >= 4096 then
    raise exception 'invalid answer';
  end if;
  if p_elapsed_ms is not null and p_elapsed_ms < 0 then
    raise exception 'invalid elapsed time';
  end if;
  if p_client_ts is null then
    raise exception 'missing client timestamp';
  end if;
  if p_app_version is not null and char_length(p_app_version) > 40 then
    raise exception 'invalid app version';
  end if;
  if not exists (select 1 from public.evaluators e where e.code = p_code) then
    raise exception 'unknown evaluator';
  end if;

  insert into public.ratings as r (code, sheet, item_id, answer, elapsed_ms, client_ts, app_version)
  values (p_code, p_sheet, p_item_id, p_answer, p_elapsed_ms, p_client_ts, p_app_version)
  on conflict (code, sheet, item_id) do update
    set answer = excluded.answer,
        elapsed_ms = excluded.elapsed_ms,
        client_ts = excluded.client_ts,
        app_version = excluded.app_version,
        updated_at = now()
    where r.client_ts is null or excluded.client_ts >= r.client_ts;

  update public.evaluators set last_seen = now() where code = p_code;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- get_progress: {name, email, completed_at, ratings: [{sheet, item_id, answer, client_ts}]}
-- for this code only, or null when the code is unknown.
-- ---------------------------------------------------------------------------------------------
create or replace function public.get_progress(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if p_code is null or p_code !~ '^[0-9A-HJKMNP-TV-Z]{10}$' then
    raise exception 'invalid code';
  end if;

  select jsonb_build_object(
           'name', e.name,
           'email', e.email,
           'completed_at', e.completed_at,
           'ratings', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'sheet', r.sheet,
                      'item_id', r.item_id,
                      'answer', r.answer,
                      'client_ts', r.client_ts) order by r.id)
               from public.ratings r
              where r.code = e.code), '[]'::jsonb))
    into result
    from public.evaluators e
   where e.code = p_code;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- finish_evaluation: record when the evaluator reached the end (the first time is kept).
-- ---------------------------------------------------------------------------------------------
create or replace function public.finish_evaluation(p_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_code is null or p_code !~ '^[0-9A-HJKMNP-TV-Z]{10}$' then
    raise exception 'invalid code';
  end if;

  update public.evaluators
     set completed_at = coalesce(completed_at, now()),
         last_seen = now()
   where code = p_code;

  if not found then
    raise exception 'unknown evaluator';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Who may call the functions: visitors (anon) and the service role, nobody else by default.
-- ---------------------------------------------------------------------------------------------
revoke all on function public.register_evaluator(text, text, text, text) from public;
revoke all on function public.save_rating(text, text, text, jsonb, integer, timestamptz, text) from public;
revoke all on function public.get_progress(text) from public;
revoke all on function public.finish_evaluation(text) from public;

grant execute on function public.register_evaluator(text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.save_rating(text, text, text, jsonb, integer, timestamptz, text) to anon, authenticated, service_role;
grant execute on function public.get_progress(text) to anon, authenticated, service_role;
grant execute on function public.finish_evaluation(text) to anon, authenticated, service_role;

-- Ask the API layer to pick up the new functions straight away.
notify pgrst, 'reload schema';
