# Supabase Sync Setup

This app uses Supabase Auth for email OTP code login and one JSON state row per user.

## 1. Create Table And RLS Policies

Run this SQL in Supabase SQL Editor:

```sql
create table if not exists public.texasholdem_user_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  active_cash_game_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.texasholdem_user_states enable row level security;

drop policy if exists "Users can read own state" on public.texasholdem_user_states;
create policy "Users can read own state"
on public.texasholdem_user_states
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own state" on public.texasholdem_user_states;
create policy "Users can insert own state"
on public.texasholdem_user_states
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own state" on public.texasholdem_user_states;
create policy "Users can update own state"
on public.texasholdem_user_states
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own state" on public.texasholdem_user_states;
create policy "Users can delete own state"
on public.texasholdem_user_states
for delete
to authenticated
using ((select auth.uid()) = user_id);
```

## 2. Configure Auth Redirect URLs

In Supabase Dashboard -> Authentication -> URL Configuration:

- Site URL: `https://poker-ema.pages.dev`
- Redirect URLs:
  - `https://poker-ema.pages.dev/**`
  - `http://localhost:8080/**`

## 3. Configure Email OTP Template

In Supabase Dashboard -> Authentication -> Emails -> Magic Link / OTP:

- Make sure the template shows `{{ .Token }}` to the user.
- Do not rely only on `{{ .ConfirmationURL }}`, because that opens the browser instead of finishing login inside the installed PWA.

Suggested plain text:

```text
Your poker login code is {{ .Token }}.
```

## 4. Configure Frontend

Edit `assets/js/00-supabase-config.js`:

```js
window.TEXASHOLDEM_SUPABASE_CONFIG = {
  enabled: true,
  url: 'https://YOUR_PROJECT.supabase.co',
  anonKey: 'YOUR_PUBLIC_ANON_KEY',
  tableName: 'texasholdem_user_states'
};
```

The anon key is intended for browser clients. Do not put the service role key in this repository.

## 5. Behavior

- Logged-out users keep using local IndexedDB.
- After email code login, the app loads the user's Supabase row.
- If the user has no Supabase row yet, the current local data is uploaded as the first cloud copy.
- Cash Game "开始记录" creates an `active` cash game with a stable ID.
- Reopening the app after closing or locking the phone restores the active cash game.
- "结束记录" marks that cash game as `settled` and stops active restoration.
