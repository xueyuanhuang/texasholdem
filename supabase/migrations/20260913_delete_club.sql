begin;
create or replace function public.poker_delete_club(club_id uuid, confirmation_name text, expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target public.poker_clubs;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select * into target from public.poker_clubs where id=club_id for update;
  if not found or target.owner_id <> auth.uid() then
    raise exception 'Only the club creator can delete this club.';
  end if;
  if confirmation_name is distinct from target.name then
    raise exception 'Type the exact club name to confirm deletion.';
  end if;
  if expected_revision is distinct from target.revision then
    raise exception 'Club records changed. Close this dialog, let the club sync, and try again.';
  end if;
  -- Memberships are removed by the club foreign key; other clubs stay untouched.
  delete from public.poker_clubs where id=target.id;
  return jsonb_build_object('deleted',target.id);
end;
$$;
revoke all on function public.poker_delete_club(uuid,text,bigint) from public, anon;
grant execute on function public.poker_delete_club(uuid,text,bigint) to authenticated;
commit;
