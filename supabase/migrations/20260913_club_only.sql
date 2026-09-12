begin;
do $migration$
declare
  definition text;
  previous text := $old$    -- Import only this authenticated user's existing server snapshot.
    select payload into p from public.texasholdem_user_states where user_id = actor;
    if p is null then raise exception '请先同步个人数据，再创建俱乐部'; end if;
$old$;
  replacement text := $new$    p := jsonb_build_object('players','[]'::jsonb,'cashGames','[]'::jsonb,'tournaments','[]'::jsonb,'_schemaVersion',5);
$new$;
begin
  select pg_get_functiondef('public.poker_club_action(text,jsonb)'::regprocedure) into definition;
  if position(previous in definition) = 0 then
    raise exception 'Unexpected club function definition; migration was not applied';
  end if;
  execute replace(definition,previous,replacement);
end;
$migration$;
commit;
