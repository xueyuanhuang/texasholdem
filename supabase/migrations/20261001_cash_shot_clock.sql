begin;
-- Shared clocks are independent of the financial snapshot and its revision.
create table public.poker_cash_timer_games (
 club_id uuid not null references public.poker_clubs(id) on delete cascade,
 game_id text not null,
 version bigint not null default 0,
 timer_id uuid,
 primary key(club_id,game_id)
);
create table public.poker_cash_timer_players (
 club_id uuid not null,
 game_id text not null,
 player_id uuid not null,
 name text not null,
 present boolean not null default true,
 primary key(club_id,game_id,player_id),
 foreign key(club_id,game_id) references public.poker_cash_timer_games on delete cascade
);
create table public.poker_cash_timer_attempts (
 club_id uuid not null,
 game_id text not null,
 id uuid not null,
 player_id uuid not null,
 started_by uuid not null,
 started_at timestamptz not null,
 ends_at timestamptz not null,
 duration integer not null check(duration in (30,60)),
 status text not null default 'running' check(status in ('running','stopped')),
 primary key(club_id,game_id,id),
 foreign key(club_id,game_id,player_id) references public.poker_cash_timer_players on delete cascade
);
create index poker_cash_timer_attempt_player on public.poker_cash_timer_attempts(club_id,game_id,player_id);
create table public.poker_cash_timer_commands (
 club_id uuid not null,
 game_id text not null,
 command_id uuid not null,
 actor_id uuid not null,
 request jsonb not null,
 primary key(club_id,game_id,command_id),
 foreign key(club_id,game_id) references public.poker_cash_timer_games on delete cascade
);
alter table public.poker_cash_timer_games enable row level security;
alter table public.poker_cash_timer_players enable row level security;
alter table public.poker_cash_timer_attempts enable row level security;
alter table public.poker_cash_timer_commands enable row level security;
revoke all on public.poker_cash_timer_games,public.poker_cash_timer_players,public.poker_cash_timer_attempts,public.poker_cash_timer_commands from public,anon,authenticated;

-- Assign server-owned identities only to active/already tracked games. Old clients
-- can omit IDs: an unambiguous exact-name match retains the previous identity.
create function public.poker_cash_timer_normalize() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare games jsonb:='[]'; g jsonb; prior jsonb; p jsonb; players jsonb; pid uuid; used uuid[]; candidate text; n integer;
begin
 if jsonb_typeof(new.payload->'cashGames') is distinct from 'array' then return new; end if;
 for g in select value from jsonb_array_elements(new.payload->'cashGames') loop
  if g->>'status'='active' or exists(select 1 from public.poker_cash_timer_games t where t.club_id=new.id and t.game_id=g->>'id') then
   if nullif(g->>'id','') is null or jsonb_typeof(g->'players') is distinct from 'array' then
    raise exception 'An active cash game requires an ID and player list.';
   end if;
   if (select count(*) from jsonb_array_elements(new.payload->'cashGames') duplicate_game where duplicate_game->>'id'=g->>'id')<>1 then
    raise exception 'Cash games must have unique IDs.';
   end if;
   prior:=null;
   if tg_op='UPDATE' then select value into prior from jsonb_array_elements(old.payload->'cashGames') where value->>'id'=g->>'id' limit 1; end if;
   players:='[]'; used:='{}';
   for p in select value from jsonb_array_elements(g->'players') loop
    pid:=null; candidate:=p->>'timerPlayerId';
    if candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
     if exists(select 1 from public.poker_cash_timer_players t where t.club_id=new.id and t.game_id=g->>'id' and t.player_id=candidate::uuid)
       or exists(select 1 from jsonb_array_elements(coalesce(prior->'players','[]')) q where q->>'timerPlayerId'=candidate) then pid:=candidate::uuid; end if;
    end if;
    if pid=any(used) then pid:=null; end if;
    if pid is null then
     select count(*),min(q->>'timerPlayerId') into n,candidate from jsonb_array_elements(coalesce(prior->'players','[]')) q where q->>'name'=p->>'name';
     if n=1 and candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and not candidate::uuid=any(used) then pid:=candidate::uuid; end if;
    end if;
    if pid is null then
     -- Removing and re-adding the same named guest keeps their match count.
     -- Never guess if more than one stored identity has that name.
     select count(*),min(t.player_id::text) into n,candidate from public.poker_cash_timer_players t
      where t.club_id=new.id and t.game_id=g->>'id' and t.name=p->>'name';
     if n=1 and not candidate::uuid=any(used) then pid:=candidate::uuid; end if;
    end if;
    if pid is null then pid:=gen_random_uuid(); end if;
    used:=array_append(used,pid);
    players:=players||jsonb_build_array(p||jsonb_build_object('timerPlayerId',pid));
   end loop;
   g:=jsonb_set(g,'{players}',players);
  end if;
  games:=games||jsonb_build_array(g);
 end loop;
 new.payload:=jsonb_set(new.payload,'{cashGames}',games);
 return new;
end;
$$;
revoke all on function public.poker_cash_timer_normalize() from public,anon,authenticated;
create trigger poker_cash_timer_normalize before insert or update of payload on public.poker_clubs
 for each row execute function public.poker_cash_timer_normalize();

create function public.poker_cash_timer_sync() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare g jsonb; p jsonb; stopped integer;
begin
 delete from public.poker_cash_timer_games t where t.club_id=new.id and not exists(
  select 1 from jsonb_array_elements(new.payload->'cashGames') saved_game where saved_game->>'id'=t.game_id);
 for g in select value from jsonb_array_elements(new.payload->'cashGames') loop
  if g->>'status'='active' or exists(select 1 from public.poker_cash_timer_games t where t.club_id=new.id and t.game_id=g->>'id') then
   insert into public.poker_cash_timer_games(club_id,game_id) values(new.id,g->>'id') on conflict do nothing;
   update public.poker_cash_timer_players set present=false where club_id=new.id and game_id=g->>'id';
   for p in select value from jsonb_array_elements(g->'players') loop
    insert into public.poker_cash_timer_players(club_id,game_id,player_id,name,present)
     values(new.id,g->>'id',(p->>'timerPlayerId')::uuid,p->>'name',true)
     on conflict(club_id,game_id,player_id) do update set name=excluded.name,present=true;
   end loop;
   update public.poker_cash_timer_attempts a set status='stopped'
    from public.poker_cash_timer_games t where t.club_id=new.id and t.game_id=g->>'id'
     and a.club_id=t.club_id and a.game_id=t.game_id and a.id=t.timer_id
     and a.status='running' and a.ends_at>clock_timestamp() and
     (g->>'status' is distinct from 'active' or not exists(select 1 from public.poker_cash_timer_players p where p.club_id=a.club_id and p.game_id=a.game_id and p.player_id=a.player_id and p.present));
   get diagnostics stopped=row_count;
   if stopped>0 then update public.poker_cash_timer_games set version=version+1 where club_id=new.id and game_id=g->>'id'; end if;
  end if;
 end loop;
 return new;
end;
$$;
revoke all on function public.poker_cash_timer_sync() from public,anon,authenticated;
create trigger poker_cash_timer_sync after insert or update of payload on public.poker_clubs
 for each row execute function public.poker_cash_timer_sync();
-- Existing active games gain identities; monetary values, revision and dates stay unchanged.
update public.poker_clubs set payload=payload where exists(
 select 1 from jsonb_array_elements(payload->'cashGames') g where g->>'status'='active');

create function public.poker_cash_timer_state(cid uuid, game jsonb, control_allowed boolean, at_time timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare t public.poker_cash_timer_games; current_timer jsonb; counts jsonb;
begin
 select * into t from public.poker_cash_timer_games where club_id=cid and game_id=game->>'id';
 if found then
  select jsonb_build_object('id',a.id,'player_id',a.player_id,'player_name',p.name,'started_at',a.started_at,
   'ends_at',a.ends_at,'duration',a.duration,'started_by',a.started_by,
   'status',case when a.status='running' and a.ends_at<=at_time then 'expired' else a.status end)
   into current_timer from public.poker_cash_timer_attempts a join public.poker_cash_timer_players p using(club_id,game_id,player_id)
   where a.club_id=cid and a.game_id=t.game_id and a.id=t.timer_id;
  select coalesce(jsonb_agg(jsonb_build_object('player_id',p.player_id,'name',p.name,'count',
    (select count(*) from public.poker_cash_timer_attempts a where a.club_id=p.club_id and a.game_id=p.game_id and a.player_id=p.player_id)) order by p.name,p.player_id),'[]')
   into counts from public.poker_cash_timer_players p where p.club_id=cid and p.game_id=t.game_id and p.present;
 end if;
 return jsonb_build_object('game_id',game->>'id','tracked',t.game_id is not null,'active',coalesce(game->>'status'='active',false),
  'can_control',control_allowed and coalesce(game->>'status'='active',false),'version',coalesce(t.version,0),'timer',current_timer,'players',coalesce(counts,'[]'));
end;
$$;
revoke all on function public.poker_cash_timer_state(uuid,jsonb,boolean,timestamptz) from public,anon,authenticated;

create function public.poker_cash_timer(action text,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 actor uuid:=auth.uid(); c public.poker_clubs; m public.poker_club_members; g jsonb; games jsonb:='[]';
 t public.poker_cash_timer_games; previous public.poker_cash_timer_commands; permitted boolean; visible boolean;
 target_id uuid; command uuid; requested_version bigint; seconds integer; request_data jsonb; at_time timestamptz; collision boolean:=false;
begin
 if actor is null then raise exception 'Please sign in first.'; end if;
 if action not in ('read','start','stop') or action is null then raise exception 'Unknown timer action.'; end if;
 -- A shared lock serializes mutations with membership/game changes, not with reads.
 if action='read' then select * into c from public.poker_clubs where id=(args->>'club_id')::uuid;
 else select * into c from public.poker_clubs where id=(args->>'club_id')::uuid for share; end if;
 if not found then raise exception 'Club not found.'; end if;
 select * into m from public.poker_club_members where club_id=c.id and user_id=actor;
 if m.status is distinct from 'approved' then raise exception 'Club approval is required.'; end if;
 if action='read' then
  if jsonb_typeof(args->'game_ids') is distinct from 'array' then raise exception 'Provide game IDs to read.'; end if;
  at_time:=clock_timestamp();
  for g in select value from jsonb_array_elements(c.payload->'cashGames') where (args->'game_ids') ? (value->>'id') loop
   permitted:=c.owner_id=actor or m.can_manage_games or exists(select 1 from jsonb_array_elements(g->'players') p where p->>'name'=m.player_name);
   visible:=c.owner_id=actor or m.can_view_history or exists(select 1 from jsonb_array_elements(g->'players') p where p->>'name'=m.player_name);
   if visible then games:=games||jsonb_build_array(public.poker_cash_timer_state(c.id,g,permitted,at_time)); end if;
  end loop;
  return jsonb_build_object('server_now',at_time,'games',games);
 end if;
 select value into g from jsonb_array_elements(c.payload->'cashGames') where value->>'id'=args->>'game_id';
 if g is null then raise exception 'Cash game not found.'; end if;
 permitted:=c.owner_id=actor or m.can_manage_games or exists(select 1 from jsonb_array_elements(g->'players') p where p->>'name'=m.player_name);
 if not permitted then raise exception 'Only this game’s participants and organizers can control its countdown.'; end if;
 command:=(args->>'command_id')::uuid; requested_version:=(args->>'expected_version')::bigint;
 if command is null or requested_version is null or requested_version<0 then raise exception 'A command ID and timer version are required.'; end if;
 request_data:=jsonb_build_object('action',action,'expected_version',requested_version);
 if action='start' then
  seconds:=(args->>'duration')::integer;
  if seconds is null or seconds not in (30,60) then raise exception 'Choose a 30 or 60 second countdown.'; end if;
  request_data:=request_data||jsonb_build_object('duration',seconds,'player_name',args->>'player_name');
 end if;
 select * into t from public.poker_cash_timer_games where club_id=c.id and game_id=g->>'id' for update;
 if not found then raise exception 'This game has no active countdown tracking.'; end if;
 at_time:=clock_timestamp();
 select * into previous from public.poker_cash_timer_commands where club_id=c.id and game_id=t.game_id and command_id=command;
 if found then
  if previous.actor_id<>actor or previous.request is distinct from request_data then raise exception 'This command ID was already used for a different request.'; end if;
  return jsonb_build_object('server_now',at_time,'games',jsonb_build_array(public.poker_cash_timer_state(c.id,g,permitted,at_time)));
 end if;
 if g->>'status' is distinct from 'active' then raise exception 'The cash game has finished.'; end if;
 if action='start' then
  if (select count(*) from public.poker_cash_timer_players where club_id=c.id and game_id=t.game_id and present and name=args->>'player_name')<>1 then raise exception 'Select a player currently in this game.'; end if;
  select player_id into target_id from public.poker_cash_timer_players where club_id=c.id and game_id=t.game_id and present and name=args->>'player_name';
  collision:=t.version<>requested_version or exists(select 1 from public.poker_cash_timer_attempts a where a.club_id=c.id and a.game_id=t.game_id and a.id=t.timer_id and a.status='running' and a.ends_at>at_time);
  if not collision then
   insert into public.poker_cash_timer_attempts(club_id,game_id,id,player_id,started_by,started_at,ends_at,duration)
    values(c.id,t.game_id,command,target_id,actor,at_time,at_time+make_interval(secs=>seconds),seconds);
   update public.poker_cash_timer_games set version=version+1,timer_id=command where club_id=c.id and game_id=t.game_id;
  end if;
 else
  collision:=t.version<>requested_version or not exists(select 1 from public.poker_cash_timer_attempts a where a.club_id=c.id and a.game_id=t.game_id and a.id=t.timer_id and a.status='running' and a.ends_at>at_time);
  if not collision then
   update public.poker_cash_timer_attempts set status='stopped' where club_id=c.id and game_id=t.game_id and id=t.timer_id;
   update public.poker_cash_timer_games set version=version+1 where club_id=c.id and game_id=t.game_id;
  end if;
 end if;
 if not collision then insert into public.poker_cash_timer_commands(club_id,game_id,command_id,actor_id,request) values(c.id,t.game_id,command,actor,request_data); end if;
 return jsonb_build_object('server_now',at_time,'games',jsonb_build_array(public.poker_cash_timer_state(c.id,g,permitted,at_time)))
  ||case when collision then '{"conflict":true}'::jsonb else '{}'::jsonb end;
end;
$$;
revoke all on function public.poker_cash_timer(text,jsonb) from public,anon;
grant execute on function public.poker_cash_timer(text,jsonb) to authenticated;
commit;
