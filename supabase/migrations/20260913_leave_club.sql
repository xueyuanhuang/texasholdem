begin;
alter table public.poker_club_members drop constraint poker_club_members_status_check;
alter table public.poker_club_members add constraint poker_club_members_status_check check(status in ('pending','approved','rejected','left'));
create function public.poker_leave_club(club_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); c public.poker_clubs;
begin
 if actor is null then raise exception 'Please sign in first.'; end if;
 select * into c from public.poker_clubs where id=club_id for update;
 if not found then raise exception 'Club not found.'; end if;
 if c.owner_id=actor then raise exception 'The creator cannot leave their own club.'; end if;
 -- Retain the identity and historical records so rejoining cannot create a duplicate.
 update public.poker_club_members m set status='left',can_manage_games=false,can_view_history=false,requested_player_name=null
 where m.club_id=c.id and m.user_id=actor;
end;
$$;
revoke all on function public.poker_leave_club(uuid) from public,anon;
grant execute on function public.poker_leave_club(uuid) to authenticated;
do $patch$
declare d text;
begin
 select pg_get_functiondef('public.poker_club_action(text,jsonb)'::regprocedure) into d;
 d:=replace(d,'where cm.user_id = actor;','where cm.user_id = actor and cm.status <> ''left'';');
 d:=replace(d,'where cm.club_id=c.id;','where cm.club_id=c.id and cm.status <> ''left'';');
 d:=replace(d,'elsif action = ''review'' then','elsif action = ''review'' then
    if exists(select 1 from public.poker_club_members where poker_club_members.club_id=c.id and user_id=(args->>''user_id'')::uuid and status=''left'') then raise exception ''This member must request to join again.''; end if;');
 execute d;
end;
$patch$;
commit;
