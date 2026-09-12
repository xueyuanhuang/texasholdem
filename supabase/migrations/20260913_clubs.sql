-- Additive: personal snapshots remain untouched as a migration backup.
begin;
create table public.poker_clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  owner_id uuid not null references auth.users(id),
  payload jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);
create table public.poker_club_members (
  club_id uuid not null references public.poker_clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  can_manage_games boolean not null default false,
  player_name text,
  requested_player_name text,
  primary key (club_id, user_id)
);
create unique index poker_club_unique_player on public.poker_club_members(club_id, player_name)
  where player_name is not null;
alter table public.poker_clubs enable row level security;
alter table public.poker_club_members enable row level security;
-- No direct table access: all access goes through the permission-checked RPC.
revoke all on public.poker_clubs, public.poker_club_members from anon, authenticated;

create function public.poker_club_action(action text, args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  actor_email text;
  c public.poker_clubs;
  m public.poker_club_members;
  target uuid;
  chosen text;
  p jsonb;
  result jsonb;
begin
  if actor is null then raise exception '请先登录'; end if;
  select email into actor_email from auth.users where id = actor;
  if actor_email is null then raise exception '需要邮箱账号'; end if;

  if action = 'list' then
    select coalesce(jsonb_agg(jsonb_build_object('id', cl.id, 'name', cl.name,
      'owner', cl.owner_id = actor, 'status', cm.status,
      'can_manage_games', cm.can_manage_games, 'player_name', cm.player_name,
      'requested_player_name', cm.requested_player_name) order by cl.name), '[]'::jsonb)
      into result from public.poker_clubs cl join public.poker_club_members cm
      on cm.club_id = cl.id where cm.user_id = actor;
    return result;
  end if;

  if action = 'create' then
    if length(trim(coalesce(args->>'name',''))) not between 1 and 80 then
      raise exception '俱乐部名称需为 1–80 字';
    end if;
    -- Import only this authenticated user's existing server snapshot.
    select payload into p from public.texasholdem_user_states where user_id = actor;
    if p is null then raise exception '请先同步个人数据，再创建俱乐部'; end if;
    insert into public.poker_clubs(name, owner_id, payload)
      values(trim(args->>'name'), actor, p) returning * into c;
    insert into public.poker_club_members(club_id,user_id,email,status,can_manage_games)
      values(c.id,actor,actor_email,'approved',true);
    return jsonb_build_object('id',c.id);
  end if;

  -- Serialize membership changes and game writes against this club.
  select * into c from public.poker_clubs where id = (args->>'club_id')::uuid for update;
  if not found then raise exception '俱乐部不存在'; end if;
  select * into m from public.poker_club_members where club_id = c.id and user_id = actor;

  if action = 'join' then
    if m.status = 'approved' then return jsonb_build_object('status','approved'); end if;
    insert into public.poker_club_members(club_id,user_id,email,requested_player_name)
      values(c.id,actor,actor_email,nullif(trim(args->>'player_name'),''))
      on conflict(club_id,user_id) do update set status='pending',
        requested_player_name=excluded.requested_player_name, can_manage_games=false;
    return jsonb_build_object('status','pending');
  end if;
  if m.status is distinct from 'approved' then raise exception '需要管理员批准加入俱乐部'; end if;

  if action = 'read' then
    return jsonb_build_object('payload',c.payload,'revision',c.revision,'updated_at',c.updated_at);
  elsif action = 'request_binding' then
    chosen := nullif(trim(args->>'player_name'),'');
    if chosen is null or not coalesce(c.payload->'players' ? chosen,false) then
      raise exception '请选择俱乐部已有玩家';
    end if;
    update public.poker_club_members set requested_player_name=chosen
      where club_id=c.id and user_id=actor;
    return '{}'::jsonb;
  elsif action = 'save' then
    if c.owner_id <> actor and not m.can_manage_games then raise exception '只有获授权的成员可以管理比赛'; end if;
    if (args->>'revision')::bigint is distinct from c.revision then
      raise exception '记录已被其他人更新，请先从云端刷新后重试';
    end if;
    p := args->'payload';
    if jsonb_typeof(p) is distinct from 'object'
      or jsonb_typeof(p->'players') is distinct from 'array'
      or jsonb_typeof(p->'tournaments') is distinct from 'array'
      or jsonb_typeof(p->'cashGames') is distinct from 'array' then
      raise exception '数据格式无效';
    end if;
    -- Organizers can change game records, but cannot change roster/settings.
    if c.owner_id <> actor and
      (p - array['cashGames','tournaments','activeCashGameId','playerActivity','cashSettings','tournamentSettings','blindTemplates']) is distinct from
      (c.payload - array['cashGames','tournaments','activeCashGameId','playerActivity','cashSettings','tournamentSettings','blindTemplates']) then
      raise exception '只有管理员可以修改玩家及设置';
    end if;
    if exists(select 1 from public.poker_club_members cm where cm.club_id=c.id
      and cm.player_name is not null and not (p->'players' ? cm.player_name)) then
      raise exception '玩家已有邮箱绑定，请先由管理员解除绑定再改名或删除';
    end if;
    update public.poker_clubs set payload=p,revision=revision+1,updated_at=now()
      where id=c.id returning * into c;
    return jsonb_build_object('revision',c.revision,'updated_at',c.updated_at);
  end if;

  if c.owner_id <> actor then raise exception '只有管理员可以执行此操作'; end if;
  if action = 'members' then
    select coalesce(jsonb_agg(to_jsonb(cm) order by cm.email),'[]'::jsonb) into result
      from public.poker_club_members cm where cm.club_id=c.id;
    return result;
  elsif action = 'review' then
    target := (args->>'user_id')::uuid;
    if target = c.owner_id then raise exception '不能更改管理员的成员权限'; end if;
    if args->>'status' not in ('approved','rejected') or args->>'status' is null then
      raise exception '无效审核结果';
    end if;
    update public.poker_club_members set status=args->>'status',can_manage_games=false,
      player_name=case when args->>'status'='rejected' then null else player_name end
      where club_id=c.id and user_id=target;
  elsif action = 'grant' then
    target := (args->>'user_id')::uuid;
    if target = c.owner_id then raise exception '不能撤销管理员权限'; end if;
    update public.poker_club_members set can_manage_games=coalesce((args->>'allowed')::boolean,false)
      where club_id=c.id and user_id=target and status='approved';
  elsif action = 'bind' then
    target := (args->>'user_id')::uuid;
    chosen := nullif(trim(args->>'player_name'),'');
    if chosen is not null and not coalesce(c.payload->'players' ? chosen,false) then
      raise exception '请选择俱乐部已有玩家';
    end if;
    update public.poker_club_members set player_name=chosen,requested_player_name=null
      where club_id=c.id and user_id=target and status='approved';
  else
    raise exception '未知俱乐部操作';
  end if;
  return '{}'::jsonb;
end;
$$;
revoke all on function public.poker_club_action(text,jsonb) from public, anon;
grant execute on function public.poker_club_action(text,jsonb) to authenticated;
commit;
