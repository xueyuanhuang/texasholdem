begin;
alter table public.poker_club_members add column join_display_name text check (length(join_display_name) <= 80);
create or replace function public.poker_join_club(club_id uuid, display_name text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if length(trim(display_name)) > 80 then raise exception 'Use a name of 80 characters or fewer.'; end if;
  result := public.poker_club_action('join',jsonb_build_object('club_id',club_id));
  update public.poker_club_members set join_display_name=nullif(trim(display_name),'')
    where poker_club_members.club_id=poker_join_club.club_id and user_id=auth.uid() and status='pending';
  return result;
end;
$$;
revoke all on function public.poker_join_club(uuid,text) from public, anon;
grant execute on function public.poker_join_club(uuid,text) to authenticated;
create or replace function public.poker_club_add_approved_player()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  club public.poker_clubs;
  display_name text;
  chosen text;
  suffix integer := 0;
begin
  if new.status <> 'approved' or new.player_name is not null then return new; end if;
  select * into club from public.poker_clubs where id=new.club_id for update;
  -- Never silently associate a new email with an existing historical player.
  display_name := coalesce(nullif(trim(new.join_display_name),''),new.email);
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
drop trigger poker_club_auto_player on public.poker_club_members;
create trigger poker_club_auto_player before insert or update of status on public.poker_club_members
  for each row execute function public.poker_club_add_approved_player();
-- Creators also appear in Players. Preserve any existing player association.
update public.poker_club_members m set status=m.status
  from public.poker_clubs c where c.id=m.club_id and c.owner_id=m.user_id
    and m.status='approved' and m.player_name is null;
create or replace function public.poker_set_club_name(club_id uuid, display_name text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
 c public.poker_clubs; m public.poker_club_members;
 chosen text; old_name text; p jsonb; item record; sub record; arr jsonb; obj jsonb;
begin
 if auth.uid() is null then raise exception 'Please sign in first.'; end if;
 select * into c from public.poker_clubs where id=club_id for update;
 select * into m from public.poker_club_members where poker_club_members.club_id=poker_set_club_name.club_id and user_id=auth.uid();
 if m.status is distinct from 'approved' then raise exception 'Club approval is required.'; end if;
 if length(trim(display_name))>80 then raise exception 'Use a name of 80 characters or fewer.'; end if;
 chosen := coalesce(nullif(trim(display_name),''),m.email);
 old_name := m.player_name;
 if chosen=old_name then return jsonb_build_object('name',chosen); end if;
 if c.payload->'players' ? chosen then raise exception 'That name is already used in this club. Choose another name.'; end if;
 p := c.payload;
 select coalesce(jsonb_agg(case when value=to_jsonb(old_name) then to_jsonb(chosen) else value end order by ord),'[]'::jsonb)
 into arr from jsonb_array_elements(p->'players') with ordinality as e(value,ord);
 if old_name is null then arr := arr || jsonb_build_array(chosen); end if;
 p := jsonb_set(p,'{players}',arr);
 if old_name is not null then
  if p->'playerActivity' ? old_name then
   p := jsonb_set(p,'{playerActivity}',((p->'playerActivity') - old_name) || jsonb_build_object(chosen,p->'playerActivity'->old_name));
  end if;
  for item in select value,ordinality-1 as idx from jsonb_array_elements(p->'cashGames') with ordinality loop
   for sub in select value,ordinality-1 as idx from jsonb_array_elements(item.value->'players') with ordinality loop
    if sub.value->>'name'=old_name then
     p:=jsonb_set(p,array['cashGames',item.idx::text,'players',sub.idx::text,'name'],to_jsonb(chosen));
    end if;
   end loop;
  end loop;
  for item in select value,ordinality-1 as idx from jsonb_array_elements(p->'tournaments') with ordinality loop
   if jsonb_typeof(item.value->'participants')='array' then
    select coalesce(jsonb_agg(case when value=to_jsonb(old_name) then to_jsonb(chosen) else value end order by ord),'[]'::jsonb)
    into arr from jsonb_array_elements(item.value->'participants') with ordinality as e(value,ord);
    p:=jsonb_set(p,array['tournaments',item.idx::text,'participants'],arr);
   end if;
   for sub in select value,ordinality-1 as idx from jsonb_array_elements(item.value->'rankings') with ordinality loop
    select coalesce(jsonb_agg(case when value=to_jsonb(old_name) then to_jsonb(chosen) else value end order by ord),'[]'::jsonb)
    into arr from jsonb_array_elements(sub.value->'players') with ordinality as e(value,ord);
    p:=jsonb_set(p,array['tournaments',item.idx::text,'rankings',sub.idx::text,'players'],arr);
   end loop;
   if item.value->'rebuys' ? old_name then
    obj := ((item.value->'rebuys') - old_name) || jsonb_build_object(chosen,item.value->'rebuys'->old_name);
    p:=jsonb_set(p,array['tournaments',item.idx::text,'rebuys'],obj);
   end if;
  end loop;
 end if;
 update public.poker_clubs set payload=p,revision=revision+1,updated_at=now() where id=c.id;
 update public.poker_club_members set player_name=chosen,automatic_player_name=chosen,join_display_name=nullif(trim(display_name),'')
  where poker_club_members.club_id=c.id and user_id=auth.uid();
 return jsonb_build_object('name',chosen);
end;
$$;
revoke all on function public.poker_set_club_name(uuid,text) from public, anon;
grant execute on function public.poker_set_club_name(uuid,text) to authenticated;
commit;
