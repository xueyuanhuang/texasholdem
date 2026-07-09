-- Optional Supabase mirror for /play users & session history
-- Run in Supabase SQL Editor if you want cloud backup alongside D1.

create table if not exists public.play_users (
  id uuid primary key,
  username text not null unique,
  nickname text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.play_sessions (
  id uuid primary key,
  room_code text not null,
  host_user_id uuid not null,
  config jsonb not null default '{}'::jsonb,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_hours numeric not null,
  settlement jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.play_users enable row level security;
alter table public.play_sessions enable row level security;

-- Service role (Worker) bypasses RLS. No public anon policies by default.
