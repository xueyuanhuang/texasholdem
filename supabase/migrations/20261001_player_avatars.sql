begin;
-- Small, normalized JPEGs stay behind the same membership checks as player profiles.
-- Thumbnails are loaded in batches; full photos are fetched only when opened.
create table public.poker_account_avatars (
 user_id uuid primary key references auth.users(id) on delete cascade,
 photo text not null check (length(photo) <= 350000),
 thumbnail text not null check (length(thumbnail) <= 33000),
 updated_at timestamptz not null default clock_timestamp()
);
alter table public.poker_account_avatars enable row level security;
revoke all on public.poker_account_avatars from public,anon,authenticated;

create function public.poker_account_avatar(action text default 'get', photo text default null, thumbnail text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); result jsonb; item text; bytes bytea; size_limit integer;
begin
 if actor is null then raise exception 'Please sign in first.'; end if;
 if action='set' then
  for item,size_limit in select v.image,v.limit_bytes from (values(photo,262144),(thumbnail,24576)) v(image,limit_bytes) loop
   if item is null or length(item)>350000 or item !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'Upload a valid JPEG profile photo.';
   end if;
   bytes:=decode(substring(item from 24),'base64');
   if octet_length(bytes)>size_limit or octet_length(bytes)<4
      or substring(bytes from 1 for 3)<>decode('ffd8ff','hex')
      or substring(bytes from octet_length(bytes)-1 for 2)<>decode('ffd9','hex') then
    raise exception 'Profile photo is invalid or too large.';
   end if;
  end loop;
  insert into public.poker_account_avatars(user_id,photo,thumbnail) values(actor,photo,thumbnail)
   on conflict(user_id) do update set photo=excluded.photo,thumbnail=excluded.thumbnail,updated_at=clock_timestamp();
 elsif action='remove' then
  delete from public.poker_account_avatars where user_id=actor;
 elsif action<>'get' then raise exception 'Unknown photo action.';
 end if;
 select jsonb_build_object('photo',a.photo,'thumbnail',a.thumbnail,'updated_at',a.updated_at)
 into result from public.poker_account_avatars a where a.user_id=actor;
 return coalesce(result,'{}'::jsonb);
end;
$$;
revoke all on function public.poker_account_avatar(text,text,text) from public,anon;
grant execute on function public.poker_account_avatar(text,text,text) to authenticated;

create function public.poker_club_avatars(club_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.poker_club_members m
  where m.club_id=poker_club_avatars.club_id and m.user_id=auth.uid() and m.status='approved') then
  raise exception 'Club membership approval is required.';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('player_name',m.player_name,'thumbnail',a.thumbnail,'updated_at',a.updated_at)), '[]'::jsonb)
 into result from public.poker_club_members m join public.poker_account_avatars a on a.user_id=m.user_id
 where m.club_id=poker_club_avatars.club_id and m.status='approved' and m.player_name is not null;
 return result;
end;
$$;
revoke all on function public.poker_club_avatars(uuid) from public,anon;
grant execute on function public.poker_club_avatars(uuid) to authenticated;

create function public.poker_player_avatar(club_id uuid, player_name text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.poker_club_members m
  where m.club_id=poker_player_avatar.club_id and m.user_id=auth.uid() and m.status='approved') then
  raise exception 'Club membership approval is required.';
 end if;
 select jsonb_build_object('photo',a.photo,'updated_at',a.updated_at) into result
 from public.poker_club_members m join public.poker_account_avatars a on a.user_id=m.user_id
 where m.club_id=poker_player_avatar.club_id and m.player_name=poker_player_avatar.player_name and m.status='approved';
 return coalesce(result,'{}'::jsonb);
end;
$$;
revoke all on function public.poker_player_avatar(uuid,text) from public,anon;
grant execute on function public.poker_player_avatar(uuid,text) to authenticated;
commit;
