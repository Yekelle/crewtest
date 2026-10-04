-- Crew'mong Us — fix delete_player safe UPDATE
-- Keeps applied migrations immutable and replaces only the affected function.

create or replace function public.delete_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_name text;
  affected_game_ids uuid[];
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

  select coalesce(array_agg(distinct game_id), '{}'::uuid[])
    into affected_game_ids
  from public.records
  where player_id = p_player_id;

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
  )
  where g.id = any(affected_game_ids);
end;
$$;

revoke all on function public.delete_player(uuid) from public;
grant execute on function public.delete_player(uuid) to authenticated;
