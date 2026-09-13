begin;
-- Older bindings predate automatic_player_name, and equal old names can also
-- differ from the account profile. Repair every proven approved association.
do $repair$
declare m record;
begin
 for m in
  select cm.club_id,cm.user_id,cm.player_name from public.poker_club_members cm
  left join public.poker_account_profiles p on p.user_id=cm.user_id
  where cm.status='approved' and cm.player_name is not null
    and cm.player_name is distinct from coalesce(p.username,cm.email)
 loop
  perform public.poker_merge_player_identity(m.club_id,m.user_id,m.player_name);
 end loop;
end;
$repair$;
commit;
