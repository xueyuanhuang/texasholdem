begin;
create or replace function public.poker_merge_player_identity(cid uuid, uid uuid, legacy text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.poker_clubs; m public.poker_club_members; chosen text; aliases text[]; p jsonb; item record; sub record; arr jsonb; obj jsonb; oldname text;
begin
 select * into c from public.poker_clubs where id=cid for update;
 select * into m from public.poker_club_members where club_id=cid and user_id=uid and status='approved';
 if m.user_id is null then raise exception 'Approved membership is required.'; end if;
 chosen:=coalesce((select username from public.poker_account_profiles where user_id=uid),m.email);
 aliases:=array_remove(array[m.player_name,m.automatic_player_name,legacy],null);
 if legacy is null or not (c.payload->'players' ? legacy) then raise exception 'Select an existing player.'; end if;
 if exists(select 1 from public.poker_club_members where club_id=cid and user_id<>uid and (player_name=any(aliases) or player_name=chosen)) then raise exception 'This player belongs to another account.'; end if;
 if c.payload->'players' ? chosen and not chosen=any(aliases) then raise exception 'The profile name belongs to a different player. Change the profile name first.'; end if;
 p:=c.payload;
 -- Do not guess how to combine two separate entries in the same game.
 for item in select value from jsonb_array_elements(p->'cashGames') loop
  if (select count(*) from jsonb_array_elements(item.value->'players') where value->>'name'=any(aliases))>1 then raise exception 'Both players appear in the same cash game. Resolve that game before linking.'; end if;
 end loop;
 for item in select value from jsonb_array_elements(p->'tournaments') loop
  if (select count(*) from jsonb_array_elements_text(item.value->'participants') where value=any(aliases))>1 then raise exception 'Both players appear in the same tournament. Resolve that game before linking.'; end if;
 end loop;
 select coalesce(jsonb_agg(n order by first_pos),'[]'::jsonb) into arr from
 (select case when value=any(aliases) then chosen else value end n,min(ord) first_pos from jsonb_array_elements_text(p->'players') with ordinality e(value,ord) group by 1) x;
 p:=jsonb_set(p,'{players}',arr);
 foreach oldname in array aliases loop
  if oldname=chosen then continue; end if;
  if p->'playerActivity' ? oldname then p:=jsonb_set(p,'{playerActivity}',(p->'playerActivity'-oldname)||jsonb_build_object(chosen,p->'playerActivity'->oldname)); end if;
 end loop;
 for item in select value,ordinality-1 idx from jsonb_array_elements(p->'cashGames') with ordinality loop
  for sub in select value,ordinality-1 idx from jsonb_array_elements(item.value->'players') with ordinality loop
   if sub.value->>'name'=any(aliases) then p:=jsonb_set(p,array['cashGames',item.idx::text,'players',sub.idx::text,'name'],to_jsonb(chosen)); end if;
  end loop;
 end loop;
 for item in select value,ordinality-1 idx from jsonb_array_elements(p->'tournaments') with ordinality loop
  if jsonb_typeof(item.value->'participants')='array' then
   select jsonb_agg(case when value=any(aliases) then chosen else value end order by ord) into arr from jsonb_array_elements_text(item.value->'participants') with ordinality e(value,ord);
   p:=jsonb_set(p,array['tournaments',item.idx::text,'participants'],coalesce(arr,'[]'::jsonb));
  end if;
  for sub in select value,ordinality-1 idx from jsonb_array_elements(item.value->'rankings') with ordinality loop
   select jsonb_agg(case when value=any(aliases) then chosen else value end order by ord) into arr from jsonb_array_elements_text(sub.value->'players') with ordinality e(value,ord);
   p:=jsonb_set(p,array['tournaments',item.idx::text,'rankings',sub.idx::text,'players'],coalesce(arr,'[]'::jsonb));
  end loop;
  obj:=item.value->'rebuys';
  foreach oldname in array aliases loop
   if oldname<>chosen and obj ? oldname then obj:=(obj-oldname)||jsonb_build_object(chosen,obj->oldname); end if;
  end loop;
  if obj is not null then p:=jsonb_set(p,array['tournaments',item.idx::text,'rebuys'],obj); end if;
 end loop;
 update public.poker_clubs set payload=p,revision=revision+1,updated_at=now() where id=cid;
 update public.poker_club_members set player_name=chosen,automatic_player_name=chosen,requested_player_name=null where club_id=cid and user_id=uid;
end;
$$;
revoke all on function public.poker_merge_player_identity(uuid,uuid,text) from public,anon,authenticated;
do $patch$
declare d text;
begin
 select pg_get_functiondef('public.poker_club_action(text,jsonb)'::regprocedure) into d;
 d:=replace(d,'update public.poker_club_members set player_name=chosen,requested_player_name=null
      where club_id=c.id and user_id=target and status=''approved'';',
 'perform public.poker_merge_player_identity(c.id,target,chosen);');
 execute d;
end;
$patch$;
-- Repair only proven previous links, never match separate players by guesswork.
do $repair$
declare m record;
begin
 for m in select club_id,user_id,player_name from public.poker_club_members where status='approved' and player_name is not null and automatic_player_name is not null and player_name<>automatic_player_name loop
  begin
   perform public.poker_merge_player_identity(m.club_id,m.user_id,m.player_name);
  exception when others then raise notice 'Link repair needs review for member %: %',m.user_id,sqlerrm;
  end;
 end loop;
end;
$repair$;
-- Remove only unfinished games with an explicitly empty roster.
update public.poker_clubs c set payload=jsonb_set(jsonb_set(c.payload,'{cashGames}',
 (select coalesce(jsonb_agg(g),'[]'::jsonb) from jsonb_array_elements(c.payload->'cashGames') g where not coalesce(g->>'status'='active' and g->'players'='[]'::jsonb,false))),
 '{activeCashGameId}',case when exists(select 1 from jsonb_array_elements(c.payload->'cashGames') g where g->>'id'=c.payload->>'activeCashGameId' and g->>'status'='active' and g->'players'='[]'::jsonb) then 'null'::jsonb else coalesce(c.payload->'activeCashGameId','null'::jsonb) end),revision=revision+1,updated_at=now()
 where exists(select 1 from jsonb_array_elements(c.payload->'cashGames') g where g->>'status'='active' and g->'players'='[]'::jsonb);
commit;
