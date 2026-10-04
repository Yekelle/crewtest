-- Crew'mong Us — Admin write API
-- All mutating operations exposed to the browser are performed through
-- Admin-only database functions. Public visitors keep read-only access.

-- Allow changing a session date/id while keeping all dependent rows.
alter table public.games
  drop constraint if exists games_session_id_fkey;
alter table public.games
  add constraint games_session_id_fkey
  foreign key (session_id)
  references public.sessions(id)
  on delete cascade
  on update cascade;

alter table public.session_participants
  drop constraint if exists session_participants_session_id_fkey;
alter table public.session_participants
  add constraint session_participants_session_id_fkey
  foreign key (session_id)
  references public.sessions(id)
  on delete cascade
  on update cascade;

-- The browser does not need direct write privileges on these tables.
revoke insert, update, delete on table
  public.sessions,
  public.games,
  public.session_participants,
  public.records
from anon, authenticated;

create or replace function public.admin_create_session(
  p_id text,
  p_date_label text,
  p_month text,
  p_label text
)
returns public.sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_row public.sessions;
begin
  if not (select private.has_role('admin')) then
    raise exception 'Accès refusé';
  end if;

  insert into public.sessions(id, date_label, month, label)
  values (p_id, p_date_label, p_month, p_label)
  returning * into result_row;

  return result_row;
end;
$$;

create or replace function public.admin_update_session(
  p_old_id text,
  p_new_id text,
  p_date_label text,
  p_month text,
  p_label text
)
returns public.sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_row public.sessions;
begin
  if not (select private.has_role('admin')) then
    raise exception 'Accès refusé';
  end if;

  if p_old_id <> p_new_id
     and exists (select 1 from public.sessions where id = p_new_id) then
    raise exception 'Une session existe déjà à cette date';
  end if;

  update public.sessions
  set id = p_new_id,
      date_label = p_date_label,
      month = p_month,
      label = p_label
  where id = p_old_id
  returning * into result_row;

  if not found then
    raise exception 'Session introuvable';
  end if;

  return result_row;
end;
$$;

create or replace function public.admin_delete_session(
  p_session_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.has_role('admin')) then
    raise exception 'Accès refusé';
  end if;

  delete from public.sessions
  where id = p_session_id;

  if not found then
    raise exception 'Session introuvable';
  end if;
end;
$$;

create or replace function public.admin_save_participants(
  p_session_id text,
  p_player_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.has_role('admin')) then
    raise exception 'Accès refusé';
  end if;

  if not exists (select 1 from public.sessions where id = p_session_id) then
    raise exception 'Session introuvable';
  end if;

  delete from public.session_participants
  where session_id = p_session_id;

  insert into public.session_participants(session_id, player_id)
  select p_session_id, player_id
  from unnest(coalesce(p_player_ids, '{}'::uuid[])) as player_id
  on conflict (session_id, player_id) do nothing;
end;
$$;

create or replace function public.admin_upsert_record(
  p_existing_record_id uuid,
  p_session_id text,
  p_game_number bigint,
  p_player_name text,
  p_role text,
  p_reports bigint,
  p_self_reports bigint,
  p_sabotages text[],
  p_repair bigint,
  p_kills text[],
  p_death text,
  p_death_pos bigint,
  p_turn bigint,
  p_tasks bigint,
  p_total_tasks bigint,
  p_ejected boolean,
  p_note text,
  p_map text,
  p_winner text,
  p_method text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player_id uuid;
  v_game_id uuid;
  v_old_game_id uuid;
  v_target_record_id uuid;
begin
  if not (select private.has_role('admin')) then
    raise exception 'Accès refusé';
  end if;

  select id
    into v_player_id
  from public.players
  where name = p_player_name;

  if v_player_id is null then
    raise exception 'Joueur introuvable';
  end if;

  if not exists (select 1 from public.sessions where id = p_session_id) then
    raise exception 'Session introuvable';
  end if;

  if p_existing_record_id is not null then
    select game_id
      into v_old_game_id
    from public.records
    where id = p_existing_record_id;

    if v_old_game_id is null then
      raise exception 'Fiche existante introuvable';
    end if;
  end if;

  insert into public.games(session_id, game_number, map, winner, method, t1_deaths)
  values (p_session_id, p_game_number, p_map, p_winner, p_method, 0)
  on conflict (session_id, game_number)
  do update set
    map = excluded.map,
    winner = excluded.winner,
    method = excluded.method
  returning id into v_game_id;

  select id
    into v_target_record_id
  from public.records
  where game_id = v_game_id
    and player_id = v_player_id;

  if v_target_record_id is not null
     and v_target_record_id <> coalesce(p_existing_record_id, '00000000-0000-0000-0000-000000000000'::uuid) then
    raise exception 'Une fiche existe déjà pour ce joueur dans cette game';
  end if;

  if p_existing_record_id is null then
    insert into public.records(
      game_id, player_id, role, reports, self_reports, sabotage_count,
      sabotages, repair, kills, death, death_pos, turn, tasks,
      total_tasks, ejected, note
    )
    values (
      v_game_id, v_player_id, p_role, coalesce(p_reports,0),
      coalesce(p_self_reports,0), coalesce(array_length(coalesce(p_sabotages,'{}'::text[]),1),0),
      coalesce(p_sabotages,'{}'::text[]), p_repair, coalesce(p_kills,'{}'::text[]),
      p_death, p_death_pos, p_turn, p_tasks, p_total_tasks,
      coalesce(p_ejected,false), coalesce(p_note,'')
    )
    returning id into v_target_record_id;
  else
    update public.records
    set
      game_id = v_game_id,
      player_id = v_player_id,
      role = p_role,
      reports = coalesce(p_reports,0),
      self_reports = coalesce(p_self_reports,0),
      sabotage_count = coalesce(array_length(coalesce(p_sabotages,'{}'::text[]),1),0),
      sabotages = coalesce(p_sabotages,'{}'::text[]),
      repair = p_repair,
      kills = coalesce(p_kills,'{}'::text[]),
      death = p_death,
      death_pos = p_death_pos,
      turn = p_turn,
      tasks = p_tasks,
      total_tasks = p_total_tasks,
      ejected = coalesce(p_ejected,false),
      note = coalesce(p_note,''),
      updated_at = now()
    where id = p_existing_record_id
    returning id into v_target_record_id;
  end if;

  update public.games g
  set t1_deaths = (
    select count(*)
    from public.records r
    where r.game_id = g.id
      and r.role = 'Crew'
      and r.turn = 1
  )
  where g.id = v_game_id;

  -- Match the existing UI behavior when an edited record moves away
  -- from a game and leaves that old game with no records.
  if v_old_game_id is not null and v_old_game_id <> v_game_id then
    update public.games g
    set t1_deaths = (
      select count(*)
      from public.records r
      where r.game_id = g.id
        and r.role = 'Crew'
        and r.turn = 1
    )
    where g.id = v_old_game_id;

    if not exists (
      select 1 from public.records where game_id = v_old_game_id
    ) then
      delete from public.games where id = v_old_game_id;
    end if;
  end if;

  return v_target_record_id;
end;
$$;

create or replace function public.admin_delete_record(
  p_record_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_id uuid;
begin
  if not (select private.has_role('admin')) then
    raise exception 'Accès refusé';
  end if;

  select game_id
    into v_game_id
  from public.records
  where id = p_record_id;

  if v_game_id is null then
    raise exception 'Fiche introuvable';
  end if;

  delete from public.records
  where id = p_record_id;

  update public.games g
  set t1_deaths = (
    select count(*)
    from public.records r
    where r.game_id = g.id
      and r.role = 'Crew'
      and r.turn = 1
  )
  where g.id = v_game_id;
end;
$$;

revoke all on function public.admin_create_session(text,text,text,text) from public, anon;
revoke all on function public.admin_update_session(text,text,text,text,text) from public, anon;
revoke all on function public.admin_delete_session(text) from public, anon;
revoke all on function public.admin_save_participants(text,uuid[]) from public, anon;
revoke all on function public.admin_upsert_record(uuid,text,bigint,text,text,bigint,bigint,text[],bigint,text[],text,bigint,bigint,bigint,bigint,boolean,text,text,text,text) from public, anon;
revoke all on function public.admin_delete_record(uuid) from public, anon;

grant execute on function public.admin_create_session(text,text,text,text) to authenticated;
grant execute on function public.admin_update_session(text,text,text,text,text) to authenticated;
grant execute on function public.admin_delete_session(text) to authenticated;
grant execute on function public.admin_save_participants(text,uuid[]) to authenticated;
grant execute on function public.admin_upsert_record(uuid,text,bigint,text,text,bigint,bigint,text[],bigint,text[],text,bigint,bigint,bigint,bigint,boolean,text,text,text,text) to authenticated;
grant execute on function public.admin_delete_record(uuid) to authenticated;
