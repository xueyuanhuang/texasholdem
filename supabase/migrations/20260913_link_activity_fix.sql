begin;
do $fix$
declare d text; m record;
begin
 select pg_get_functiondef('public.poker_merge_player_identity(uuid,uuid,text)'::regprocedure) into d;
 d:=replace(d,'(p->''playerActivity''-oldname)','((p->''playerActivity'')-oldname)');
 execute d;
 for m in select club_id,user_id,player_name from public.poker_club_members where status='approved' and player_name is not null and automatic_player_name is not null and player_name<>automatic_player_name loop
  perform public.poker_merge_player_identity(m.club_id,m.user_id,m.player_name);
 end loop;
end;
$fix$;
commit;
