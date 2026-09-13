begin;
-- Return only games containing this membership's server-controlled player identity.
create function public.poker_member_game_payload(payload jsonb, player text)
returns jsonb language sql immutable set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'players',payload->'players','_schemaVersion',5,
  'cashGames',coalesce((select jsonb_agg(g order by n) from jsonb_array_elements(payload->'cashGames') with ordinality e(g,n) where exists(select 1 from jsonb_array_elements(g->'players') p where p->>'name'=player)),'[]'::jsonb),
  'tournaments',coalesce((select jsonb_agg(g order by n) from jsonb_array_elements(payload->'tournaments') with ordinality e(g,n) where (g->'participants') ? player or exists(select 1 from jsonb_array_elements(g->'rankings') r where (r->'players') ? player)),'[]'::jsonb),
  'activeTournament',case when (payload->'activeTournament'->'players') ? player then payload->'activeTournament' else 'null'::jsonb end
 );
$$;
revoke all on function public.poker_member_game_payload(jsonb,text) from public,anon,authenticated;
do $patch$
declare d text;
begin
 select pg_get_functiondef('public.poker_club_action(text,jsonb)'::regprocedure) into d;
 d:=replace(d,'jsonb_build_object(''players'',c.payload->''players'',''cashGames'',''[]''::jsonb,''tournaments'',''[]''::jsonb,''_schemaVersion'',5)','public.poker_member_game_payload(c.payload,m.player_name)');
 d:=replace(d,'''cashGames'',''tournaments'',''activeCashGameId''','''cashGames'',''tournaments'',''activeTournament'',''activeCashGameId''');
 execute d;
end;
$patch$;
commit;
