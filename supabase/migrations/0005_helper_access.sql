-- Crew'mong Us — Helper access
-- Helpers may create and modify game records.
-- Structural administration (sessions, participants, streamers, deletions)
-- remains Admin-only.

-- Keep role lookup available to authenticated users, but only for their own row.
grant select on table public.user_roles to authenticated;

drop policy if exists "Users can read own role" on public.user_roles;
create policy "Users can read own role"
  on public.user_roles for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function private.can_edit_records()
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
      and role in ('admin', 'helper')
  );
$$;

revoke all on function private.can_edit_records() from public;
grant execute on function private.can_edit_records() to authenticated;

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
  if not (select private.can_edit_records()) then
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

revoke all on function public.admin_upsert_record(uuid,text,bigint,text,text,bigint,bigint,text[],bigint,text[],text,bigint,bigint,bigint,bigint,boolean,text,text,text,text) from public, anon;
grant execute on function public.admin_upsert_record(uuid,text,bigint,text,text,bigint,bigint,text[],bigint,text[],text,bigint,bigint,bigint,bigint,boolean,text,text,text,text) to authenticated;
