begin;
-- Exact-code lookup exposes only the name, never the roster or game records.
create or replace function public.poker_club_lookup(club_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  select jsonb_build_object('id', c.id, 'name', c.name) into result
    from public.poker_clubs c where c.id = club_id;
  if result is null then raise exception '未找到俱乐部，请检查编号'; end if;
  return result;
end;
$$;
revoke all on function public.poker_club_lookup(uuid) from public, anon;
grant execute on function public.poker_club_lookup(uuid) to authenticated;
commit;
