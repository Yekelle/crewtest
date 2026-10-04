-- Crew'mong Us — initial Supabase schema
-- This is the structure that will replace the current localStorage data.
-- RLS is enabled now, but policies/permissions will be added later
-- when Public / Helper / Admin access is implemented.

create extension if not exists pgcrypto;

create table public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  handle text not null unique,
  active boolean not null default true,
  source text not null default 'integrated'
    check (source in ('integrated', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sessions (
  id text primary key
    check (id ~ '^\d{4}-\d{2}-\d{2}$'),
  date_label text not null,
  month text not null
    check (month ~ '^\d{4}-\d{2}$'),
  label text not null,
  created_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  session_id text not null
    references public.sessions(id)
    on delete cascade,
  game_number bigint not null,
  map text not null,
  winner text not null
    check (winner in ('Imposteurs', 'Crewmates')),
  method text not null,
  t1_deaths bigint not null default 0
    check (t1_deaths >= 0),
  created_at timestamptz not null default now(),
  unique (session_id, game_number)
);

create table public.session_participants (
  session_id text not null
    references public.sessions(id)
    on delete cascade,
  player_id uuid not null
    references public.players(id)
    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, player_id)
);

create table public.records (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null
    references public.games(id)
    on delete cascade,
  player_id uuid not null
    references public.players(id)
    on delete cascade,
  role text not null
    check (role in ('Imposteur', 'Crew')),
  reports bigint not null default 0
    check (reports >= 0),
  self_reports bigint not null default 0
    check (self_reports >= 0),
  sabotage_count bigint not null default 0
    check (sabotage_count >= 0),
  sabotages text[] not null default '{}'::text[],
  repair bigint,
  kills text[] not null default '{}'::text[],
  death text,
  death_pos bigint,
  turn bigint,
  tasks bigint,
  total_tasks bigint,
  ejected boolean not null default false,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, player_id)
);

create index games_session_id_idx
  on public.games(session_id);

create index records_game_id_idx
  on public.records(game_id);

create index records_player_id_idx
  on public.records(player_id);

create index session_participants_player_id_idx
  on public.session_participants(player_id);

-- Keep the database protected while we build the access system.
alter table public.players enable row level security;
alter table public.sessions enable row level security;
alter table public.games enable row level security;
alter table public.session_participants enable row level security;
alter table public.records enable row level security;

revoke all on table
  public.players,
  public.sessions,
  public.games,
  public.session_participants,
  public.records
from anon, authenticated;
