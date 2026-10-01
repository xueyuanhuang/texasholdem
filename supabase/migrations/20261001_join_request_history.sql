begin;
-- Reuse the membership audit trail; permission-only changes are not join events.
create index poker_member_access_events_membership
 on public.poker_member_access_events(club_id,member_id,id desc)
 where (old_access->>'status') is distinct from (new_access->>'status');

do $migration$
declare d text; marker text := 'if action = ''members'' then';
begin
 select pg_get_functiondef('public.poker_club_action(text,jsonb)'::regprocedure) into d;
 if position(marker in d)=0 then raise exception 'Members branch not found'; end if;
 -- This branch stays behind the existing approved-owner authorization check.
 d:=replace(d,marker,'if action = ''join_requests'' then
    select coalesce(jsonb_agg(to_jsonb(cm) || jsonb_build_object(''membership_events'',events.items)
      order by events.latest_id desc nulls last,cm.email),''[]''::jsonb) into result
    from public.poker_club_members cm
    left join lateral (
      select max(e.id) latest_id,coalesce(jsonb_agg(jsonb_build_object(
        ''happened_at'',e.happened_at,''previous_status'',e.old_access->>''status'',
        ''status'',e.new_access->>''status'') order by e.id desc),''[]''::jsonb) items
      from public.poker_member_access_events e
      where e.club_id=cm.club_id and e.member_id=cm.user_id
        and (e.old_access->>''status'') is distinct from (e.new_access->>''status'')
    ) events on true
    where cm.club_id=c.id and cm.user_id<>c.owner_id;
    return result;
  elsif action = ''members'' then');
 execute d;
end;
$migration$;
commit;
