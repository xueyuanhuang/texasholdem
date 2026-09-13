begin;
-- Repeated approval (for example from an old browser tab) must be idempotent.
do $migration$
declare d text; old_clause text := 'where club_id=c.id and user_id=target;
  elsif action = ''grant'' then';
begin
 select pg_get_functiondef('public.poker_club_action(text,jsonb)'::regprocedure) into d;
 -- History access adds a guard immediately after the grant branch; retain it.
 if position(old_clause in d)=0 then raise exception 'Review branch not found'; end if;
 d:=replace(d,old_clause,'where club_id=c.id and user_id=target and status is distinct from args->>''status'';
  elsif action = ''grant'' then');
 execute d;
end;
$migration$;
-- Record future membership/permission changes so unexpected losses are traceable.
create table public.poker_member_access_events (
 id bigint generated always as identity primary key,
 happened_at timestamptz not null default now(),
 club_id uuid not null,
 member_id uuid not null,
 actor_id uuid,
 old_access jsonb,
 new_access jsonb not null
);
alter table public.poker_member_access_events enable row level security;
revoke all on public.poker_member_access_events from public,anon,authenticated;
create function public.poker_record_member_access() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare previous jsonb; current_access jsonb;
begin
 current_access:=jsonb_build_object('status',new.status,'history',new.can_view_history,'games',new.can_manage_games);
 if tg_op='UPDATE' then
  previous:=jsonb_build_object('status',old.status,'history',old.can_view_history,'games',old.can_manage_games);
 end if;
 if previous is distinct from current_access then
  insert into public.poker_member_access_events(club_id,member_id,actor_id,old_access,new_access)
  values(new.club_id,new.user_id,auth.uid(),previous,current_access);
 end if;
 return new;
end;
$$;
revoke all on function public.poker_record_member_access() from public,anon,authenticated;
create trigger poker_member_access_audit after insert or update on public.poker_club_members
 for each row execute function public.poker_record_member_access();
commit;
