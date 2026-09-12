begin;
-- Keep the generated identity on removal so rejoining does not duplicate history.
alter table public.poker_club_members add column if not exists automatic_player_name text;
create or replace function public.poker_club_add_approved_player()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  club public.poker_clubs;
  display_name text;
  chosen text;
  suffix integer := 0;
begin
  if new.status <> 'approved' or new.player_name is not null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'approved' then return new; end if;
  select * into club from public.poker_clubs where id=new.club_id for update;
  -- Never silently associate a new email with an existing historical player.
  select coalesce(nullif(trim(raw_user_meta_data->>'full_name'),''),
                  nullif(trim(raw_user_meta_data->>'name'),''),
                  nullif(split_part(email,'@',1),''),'Player')
    into display_name from auth.users where id=new.user_id;
  display_name := left(coalesce(display_name,'Player'),60);
  chosen := coalesce(new.automatic_player_name,display_name);
  if new.automatic_player_name is null then
    while coalesce(club.payload->'players' ? chosen,false) or exists(
      select 1 from public.poker_club_members where club_id=new.club_id and player_name=chosen and user_id<>new.user_id
    ) loop
      suffix := suffix + 1;
      chosen := display_name || ' (' || suffix || ')';
    end loop;
  end if;
  new.player_name := chosen;
  new.automatic_player_name := chosen;
  new.requested_player_name := null;
  if not coalesce(club.payload->'players' ? chosen,false) then
    update public.poker_clubs set
      payload=jsonb_set(payload,'{players}',coalesce(payload->'players','[]'::jsonb) || jsonb_build_array(chosen)),
      revision=revision+1,updated_at=now() where id=new.club_id;
  end if;
  return new;
end;
$$;
revoke all on function public.poker_club_add_approved_player() from public, anon, authenticated;
create trigger poker_club_auto_player before update of status on public.poker_club_members
  for each row execute function public.poker_club_add_approved_player();
commit;
