begin;
alter table public.poker_club_members add column can_view_history boolean not null default false;
update public.poker_club_members m set can_view_history=true from public.poker_clubs c where c.id=m.club_id and c.owner_id=m.user_id;
update public.poker_club_members m set can_manage_games=false from public.poker_clubs c where c.id=m.club_id and c.owner_id<>m.user_id;
do $migration$
declare d text;
begin
 select pg_get_functiondef('public.poker_club_action(text,jsonb)'::regprocedure) into d;
 d:=replace(d,'''can_manage_games'', cm.can_manage_games,','''can_view_history'', (cl.owner_id=actor or cm.can_view_history), ''can_manage_games'', cm.can_manage_games,');
 d:=replace(d,'if action = ''read'' then','if action = ''read'' then
    if c.owner_id <> actor and not m.can_view_history then
      return jsonb_build_object(''payload'',jsonb_build_object(''players'',c.payload->''players'',''cashGames'',''[]''::jsonb,''tournaments'',''[]''::jsonb,''_schemaVersion'',5),''revision'',c.revision,''updated_at'',c.updated_at);
    end if;');
 d:=replace(d,'elsif action = ''save'' then','elsif action = ''save'' then
    if c.owner_id <> actor and not m.can_view_history then raise exception ''History access is required to manage games.''; end if;');
 d:=replace(d,'set status=args->>''status'',can_manage_games=false,','set status=args->>''status'',can_manage_games=false,can_view_history=false,');
 d:=replace(d,'elsif action = ''grant'' then','elsif action = ''grant'' then
    if coalesce((args->>''allowed'')::boolean,false) and not exists(select 1 from public.poker_club_members where club_id=c.id and user_id=(args->>''user_id'')::uuid and can_view_history) then
      raise exception ''Grant history access before game access.'';
    end if;');
 execute d;
end;
$migration$;
create or replace function public.poker_grant_history(club_id uuid, member_id uuid, allowed boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.poker_clubs;
begin
 select * into c from public.poker_clubs where id=club_id for update;
 if auth.uid() is null or c.owner_id is distinct from auth.uid() then raise exception 'Only the creator can manage history access.'; end if;
 if member_id=c.owner_id then raise exception 'The creator always has history access.'; end if;
 update public.poker_club_members set can_view_history=coalesce(allowed,false),can_manage_games=case when coalesce(allowed,false) then can_manage_games else false end
 where poker_club_members.club_id=c.id and user_id=member_id and status='approved';
end;
$$;
revoke all on function public.poker_grant_history(uuid,uuid,boolean) from public,anon;
grant execute on function public.poker_grant_history(uuid,uuid,boolean) to authenticated;
commit;
