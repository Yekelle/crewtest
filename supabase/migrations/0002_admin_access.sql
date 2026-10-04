-- Crew'mong Us — Admin auth + public read access
-- Public pages may read the statistics.
-- Only authenticated Admin users may modify players.
-- Sessions/games/records writes remain local until their own Supabase write layer is migrated.

create schema if not exists private;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'helper')),
  created_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;

revoke all on table public.user_roles from anon, authenticated;

create or replace function private.has_role(required_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = required_role
  );
$$;

revoke all on function private.has_role(text) from public;
grant execute on function private.has_role(text) to authenticated;

-- The public statistics are intentionally readable without login.
grant select on table
  public.players,
  public.sessions,
  public.games,
  public.session_participants,
  public.records
to anon, authenticated;

drop policy if exists "Public can read players" on public.players;
create policy "Public can read players"
  on public.players for select
  to anon, authenticated
  using (true);

drop policy if exists "Public can read sessions" on public.sessions;
create policy "Public can read sessions"
  on public.sessions for select
  to anon, authenticated
  using (true);

drop policy if exists "Public can read games" on public.games;
create policy "Public can read games"
  on public.games for select
  to anon, authenticated
  using (true);

drop policy if exists "Public can read session participants" on public.session_participants;
create policy "Public can read session participants"
  on public.session_participants for select
  to anon, authenticated
  using (true);

drop policy if exists "Public can read records" on public.records;
create policy "Public can read records"
  on public.records for select
  to anon, authenticated
  using (true);

-- Player management is Admin-only for now.
grant insert, update, delete on table public.players to authenticated;

drop policy if exists "Admins can insert players" on public.players;
create policy "Admins can insert players"
  on public.players for insert
  to authenticated
  with check ((select private.has_role('admin')));

drop policy if exists "Admins can update players" on public.players;
create policy "Admins can update players"
  on public.players for update
  to authenticated
  using ((select private.has_role('admin')))
  with check ((select private.has_role('admin')));

drop policy if exists "Admins can delete players" on public.players;
create policy "Admins can delete players"
  on public.players for delete
  to authenticated
  using ((select private.has_role('admin')));

-- Secure deletion used by the Admin UI.
create or replace function public.delete_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_name text;
begin
  if not (select private.has_role('admin')) then
    raise exception 'Accès refusé';
  end if;

  select name
    into player_name
  from public.players
  where id = p_player_id;

  if player_name is null then
    raise exception 'Joueur introuvable';
  end if;

  update public.records
  set
    kills = array_remove(kills, player_name),
    death = case
      when death is not null then replace(death, player_name, 'un joueur supprimé')
      else null
    end,
    note = replace(note, player_name, 'un joueur supprimé'),
    updated_at = now()
  where player_id <> p_player_id
    and (
      player_name = any(kills)
      or death like '%' || player_name || '%'
      or note like '%' || player_name || '%'
    );

  delete from public.players
  where id = p_player_id;

  update public.games g
  set t1_deaths = (
    select count(*)
    from public.records r
    where r.game_id = g.id
      and r.role = 'Crew'
      and r.turn = 1
  );
end;
$$;

revoke all on function public.delete_player(uuid) from public;
grant execute on function public.delete_player(uuid) to authenticated;
