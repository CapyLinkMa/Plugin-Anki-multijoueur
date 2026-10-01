-- Plugin Anki multijoueur : base de données Supabase.
-- À coller une fois dans Supabase → SQL Editor → New query → Run.
-- Relancer le script ne casse rien (il recrée les règles et les fonctions).
--
-- Sécurité : chaque joueur est un utilisateur anonyme de Supabase Auth.
-- Les règles (RLS) font que chacun ne voit que les joueurs de SON groupe,
-- et ne peut écrire que ses propres lignes. On n'y stocke que des chiffres
-- d'étude et un pseudo : jamais le contenu des cartes.

create extension if not exists pgcrypto;

-- -- tables -------------------------------------------------------------------------------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null check (char_length(name) between 1 and 40),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key default auth.uid() references auth.users on delete cascade,
  pseudo text not null check (char_length(pseudo) between 1 and 24),
  avatar text not null default '🙂' check (char_length(avatar) <= 8),
  daily_goal int not null default 100 check (daily_goal between 10 and 5000),
  program text check (char_length(program) <= 40),
  group_id uuid references public.groups on delete set null,
  status text check (char_length(status) <= 20),
  status_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.days (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  cards int not null default 0 check (cards between 0 and 100000),
  minutes int not null default 0 check (minutes between 0 and 1440),
  new_cards int not null default 0 check (new_cards between 0 and 100000),
  review_count int not null default 0 check (review_count between 0 and 100000),
  retention real check (retention between 0 and 1),
  overdue int check (overdue >= 0),
  goal int not null default 100 check (goal between 10 and 5000),
  primary key (user_id, day)
);

create table if not exists public.events (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (char_length(kind) <= 30),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_group_idx on public.events (group_id, id desc);

create table if not exists public.reactions (
  event_id bigint not null references public.events on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  emoji text not null check (emoji in ('👏', '🔥', '💪', '😮', '❤️')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id, emoji)
);

-- -- helper: my group (security definer, so the rules below don't loop on themselves) ----
create or replace function public.my_group() returns uuid
language sql stable security definer set search_path = public as $$
  select group_id from public.profiles where id = auth.uid()
$$;

-- -- rules (row level security) -----------------------------------------------------------
alter table public.groups enable row level security;
alter table public.profiles enable row level security;
alter table public.days enable row level security;
alter table public.events enable row level security;
alter table public.reactions enable row level security;

drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated
  using (id = public.my_group());

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or (group_id is not null and group_id = public.my_group()));
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = auth.uid() and group_id is null);
drop policy if exists profiles_update on public.profiles;
-- the group only changes through join_group / create_group / leave_group
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and group_id is not distinct from public.my_group());

drop policy if exists days_select on public.days;
create policy days_select on public.days for select to authenticated
  using (user_id = auth.uid()
         or user_id in (select p.id from public.profiles p
                        where p.group_id is not null and p.group_id = public.my_group()));
drop policy if exists days_insert on public.days;
create policy days_insert on public.days for insert to authenticated with check (user_id = auth.uid());
drop policy if exists days_update on public.days;
create policy days_update on public.days for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated
  using (group_id = public.my_group());
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated
  with check (user_id = auth.uid() and group_id = public.my_group());

drop policy if exists reactions_select on public.reactions;
create policy reactions_select on public.reactions for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.group_id = public.my_group()));
drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.events e where e.id = event_id and e.group_id = public.my_group()));
drop policy if exists reactions_delete on public.reactions;
create policy reactions_delete on public.reactions for delete to authenticated using (user_id = auth.uid());

-- -- groups: create / join / leave ----------------------------------------------------------
create or replace function public.create_group(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Crée ton profil avant de créer un groupe.';
  end if;
  loop
    v_code := upper(substr(translate(encode(gen_random_bytes(6), 'base64'), '+/=0O1Il', ''), 1, 6));
    exit when char_length(v_code) = 6 and not exists (select 1 from public.groups where code = v_code);
  end loop;
  insert into public.groups (code, name, created_by) values (v_code, trim(p_name), auth.uid()) returning id into v_id;
  update public.profiles set group_id = v_id, updated_at = now() where id = auth.uid();
  insert into public.events (group_id, user_id, kind) values (v_id, auth.uid(), 'joined');
  return v_code;
end $$;

create or replace function public.join_group(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_name text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Crée ton profil avant de rejoindre un groupe.';
  end if;
  select id, name into v_id, v_name from public.groups where code = upper(trim(p_code));
  if v_id is null then
    raise exception 'Aucun groupe avec ce code.';
  end if;
  if (select count(*) from public.profiles where group_id = v_id) >= 20 then
    raise exception 'Ce groupe est complet (20 joueurs).';
  end if;
  update public.profiles set group_id = v_id, updated_at = now() where id = auth.uid();
  insert into public.events (group_id, user_id, kind) values (v_id, auth.uid(), 'joined');
  return v_name;
end $$;

create or replace function public.leave_group() returns void
language sql security definer set search_path = public as $$
  update public.profiles set group_id = null, updated_at = now() where id = auth.uid()
$$;

-- -- who may use what (new tables are not exposed automatically) ------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.groups to authenticated;
grant select, insert, update on public.days to authenticated;
grant select, insert on public.events to authenticated;
grant select, insert, delete on public.reactions to authenticated;
revoke all on function public.create_group(text), public.join_group(text), public.leave_group(), public.my_group()
  from public, anon;
grant execute on function public.create_group(text), public.join_group(text), public.leave_group(), public.my_group()
  to authenticated;
