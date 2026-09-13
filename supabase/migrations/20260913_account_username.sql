begin;
create table public.poker_account_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 username text check (length(username) between 1 and 80)
);
alter table public.poker_account_profiles enable row level security;
revoke all on public.poker_account_profiles from public,anon,authenticated;
-- Carry forward an explicitly chosen name, preferring a club the account created.
insert into public.poker_account_profiles(user_id,username)
 select distinct on (m.user_id) m.user_id,m.join_display_name
 from public.poker_club_members m join public.poker_clubs c on c.id=m.club_id
 where nullif(trim(m.join_display_name),'') is not null
 order by m.user_id,(c.owner_id=m.user_id) desc,c.id;
create or replace function public.poker_account_profile(action text, username text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); chosen text; member record;
begin
 if actor is null then raise exception 'Please sign in first.'; end if;
 if action='set' then
  chosen:=nullif(trim(username),'');
  if length(chosen)>80 then raise exception 'Use a username of 80 characters or fewer.'; end if;
  insert into public.poker_account_profiles(user_id,username) values(actor,chosen)
   on conflict(user_id) do update set username=excluded.username;
  -- Rename the same player in every approved club in one transaction.
  for member in select c.id from public.poker_clubs c join public.poker_club_members m on m.club_id=c.id
   where m.user_id=actor and (m.status='approved' or m.automatic_player_name is not null) order by c.id for update of c loop
    perform public.poker_set_club_name(member.id,chosen);
  end loop;
 elsif action<>'get' then raise exception 'Unknown profile action.';
 end if;
 select p.username into chosen from public.poker_account_profiles p where user_id=actor;
 return jsonb_build_object('username',chosen);
end;
$$;
revoke all on function public.poker_account_profile(text,text) from public,anon;
grant execute on function public.poker_account_profile(text,text) to authenticated;
-- Per-club names can no longer be set directly by clients.
revoke all on function public.poker_set_club_name(uuid,text) from authenticated;
create or replace function public.poker_join_club(club_id uuid, display_name text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 return public.poker_club_action('join',jsonb_build_object('club_id',club_id));
end;
$$;
do $migration$
declare d text;
begin
 select pg_get_functiondef('public.poker_set_club_name(uuid,text)'::regprocedure) into d;
 d:=replace(d,'if m.status is distinct from ''approved'' then','if m.user_id is null then');
 d:=replace(d,'old_name := m.player_name;','old_name := coalesce(m.player_name,m.automatic_player_name);');
 d:=replace(d,'set player_name=chosen,automatic_player_name=chosen','set player_name=case when status=''approved'' then chosen else null end,automatic_player_name=chosen');
 execute d;
 select pg_get_functiondef('public.poker_club_add_approved_player()'::regprocedure) into d;
 d:=replace(d,'display_name := coalesce(nullif(trim(new.join_display_name),''''),new.email);',
 'select coalesce((select username from public.poker_account_profiles where user_id=new.user_id),new.email) into display_name;');
 execute d;
end;
$migration$;
commit;
