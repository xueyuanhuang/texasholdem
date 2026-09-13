begin;
create table public.poker_username_history (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 old_name text,
 new_name text not null,
 changed_at timestamptz not null default clock_timestamp()
);
create index poker_username_history_user on public.poker_username_history(user_id,id desc);
alter table public.poker_username_history enable row level security;
revoke all on public.poker_username_history from public,anon,authenticated;
-- Baselines are current names, not reconstructed past changes.
insert into public.poker_username_history(user_id,new_name)
 select u.id,coalesce(p.username,u.email) from auth.users u
 left join public.poker_account_profiles p on p.user_id=u.id
 where p.user_id is not null or exists(select 1 from public.poker_club_members m where m.user_id=u.id);
create function public.poker_record_username_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare email_name text; previous_name text; next_name text;
begin
 select email into email_name from auth.users where id=new.user_id;
 previous_name:=case when tg_op='UPDATE' then coalesce(old.username,email_name) else email_name end;
 next_name:=coalesce(new.username,email_name);
 if previous_name is distinct from next_name then
  insert into public.poker_username_history(user_id,old_name,new_name) values(new.user_id,previous_name,next_name);
 end if;
 return new;
end;
$$;
revoke all on function public.poker_record_username_change() from public,anon,authenticated;
create trigger poker_audit_username after insert or update of username on public.poker_account_profiles
 for each row execute function public.poker_record_username_change();
create function public.poker_player_details(club_id uuid, player_name text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare member public.poker_club_members; changes jsonb; roster jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.poker_club_members m where m.club_id=poker_player_details.club_id and m.user_id=auth.uid() and m.status='approved') then
  raise exception 'Club membership approval is required.';
 end if;
 select payload->'players' into roster from public.poker_clubs where id=club_id;
 if not coalesce(roster ? player_name,false) then raise exception 'Player not found in this club.'; end if;
 select * into member from public.poker_club_members m where m.club_id=poker_player_details.club_id and m.player_name=poker_player_details.player_name and m.status='approved';
 if not found then return jsonb_build_object('name',player_name,'email',null,'history','[]'::jsonb); end if;
 select coalesce(jsonb_agg(jsonb_build_object('old_name',h.old_name,'new_name',h.new_name,'changed_at',h.changed_at) order by h.id desc),'[]'::jsonb)
 into changes from public.poker_username_history h where h.user_id=member.user_id;
 return jsonb_build_object('name',player_name,'email',member.email,'history',changes);
end;
$$;
revoke all on function public.poker_player_details(uuid,text) from public,anon;
grant execute on function public.poker_player_details(uuid,text) to authenticated;
commit;
