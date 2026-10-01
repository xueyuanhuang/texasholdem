# Clubs

## Agreed behavior

- Everyone logs in using their own email. Credentials are not shared.
- A club's creator is its owner/manager; any authenticated account can create a club.
- Joining requires manager approval. Applicants cannot read club history.
- Approved members can read all club game history, not just their own games.
- Email-to-player binding is a separate manager-approved association with an existing roster name.
- A roster name can be bound to only one account within a club. The same account may belong to several clubs.
- The manager grants/revokes standing game-management permission. Approval is not required for each game.
- Organizers may create, update and delete games and configure game settings. Only the owner manages members and the roster.
- Removing a member clears their game-management permission and player binding. Reapplying does not restore either automatically.

## Activation

The production project has the club migration installed and `clubsEnabled: true`. For any new Supabase project, keep this flag false until its migration is applied so deploying the frontend first cannot break existing sync.

1. Apply `supabase/migrations/20260913_clubs.sql` to the same Supabase project that hosts `texasholdem_user_states`.
2. Set `clubsEnabled: true` in `assets/js/00-supabase-config.js`, then deploy the frontend and service worker together.
3. Sign in as the intended club owner. In Settings, choose Personal records, check the history, then create the club.
4. Creation copies that account's latest server snapshot atomically. The original personal server row is retained. Subsequent club changes are independent of that backup.
5. Give members the club number. They submit a join request using the club number only. After the manager approves membership, members can request player binding separately. The manager confirms the binding and any game-management grant.

The migration adds empty club tables; real club creation remains an explicit action in Settings. No account is automatically made a manager based on an email string in source code.

## Data and permission boundaries

`poker_clubs` stores shared game state and a monotonically increasing revision. `poker_club_members` stores approval status, standing permission and player bindings. Both tables have RLS enabled and no direct authenticated/anonymous access. The authenticated `poker_club_action` RPC checks `auth.uid()` and current membership for each operation; frontend hiding is only a convenience.

All per-club mutation operations lock the club row. Saves must supply the revision read by the client; stale writes are rejected instead of replacing another device's changes. Client saves are serialized and capture the actor, club and payload before awaiting a response. Conflicts or permission failures freeze writes until a refresh. Export pending local changes before refreshing if they need to be retained.

Club mode requires a successful online authorization/read before displaying history and an online connection for writes. Revocation is enforced by the server on the next request. Previously viewed/exported copies cannot be remotely recalled. The UI refresh button reloads permissions and records; this version does not provide live realtime subscriptions.

Local caches are separated by authenticated user and club. Existing anonymous/local-mode data is kept under its original key. New account caches start empty; they do not automatically import another account's browser cache. Existing signed-in records restore from the personal server row. To move local-only records, export them from local mode and import explicitly into the intended personal account before creating its club.

Bindings currently reference existing player names to preserve the application's history format. A bound player cannot be renamed/deleted until the owner unbinds the account; historical names are handled by the existing roster rename flow. Club ownership transfer and multiple managers are not included in this first version.

## Verification

### Join requests and history

Apply `supabase/migrations/20261001_join_request_history.sql` after the existing migrations (including `20260913_permission_stability.sql`) to enable the detailed timeline. The new owner-only `join_requests` action includes pending, approved, rejected and left memberships. The existing `members` action is unchanged for player management. The frontend supports a staged rollout: if the server reports an unknown action, it uses `members` so pending counts and retained approved/removed records work immediately, with an explicit note that detailed history is not available yet. Authorization/network failures do not trigger this fallback.

Only pending requests count as “to review” or show approval/decline controls. Processed accounts remain under Request history, including approved rejoin requests and accounts whose player has been removed. Each account displays its recorded membership transitions, newest first; permission-only changes are excluded. Reapplying moves the account back to Pending approval while keeping its previous events. Approved accounts retain their player-link and access controls.

This reuses the existing membership audit log. Accounts with no recorded transitions still appear with their current status; request dates and changes from before audit tracking began cannot be reconstructed. No historical dates are invented. Leaving/withdrawing also remains visible to the owner here, while the member’s own club list and player management keep their existing behavior.

The Linked player picker in Manage player and join-request history includes a search field for names, pinyin and initials. Matching players appear immediately as clickable rows below the search, in A–Z order (Chinese names use the app’s existing pinyin ordering). Filtering preserves the current selection, including when there are no matches; the owner taps a player and clicks Save player link to apply a change.

### Profile photos

Apply `20261001_player_avatars.sql` before deploying `02-avatars.js`. Signed-in players can upload, replace or remove their own photo in the account menu. The browser accepts JPG, PNG and WebP up to 10 MB, strips metadata by re-encoding, and produces a JPEG up to 1024 pixels / 256 KiB plus a 96-pixel thumbnail up to 24 KiB. These bounded images live in a separate RLS-protected table, outside game snapshots and local-storage backups.

Only the account owner can change their photo. Approved club members can fetch thumbnails for currently approved, linked players; full photos are fetched individually when opened. Pending, removed and unrelated accounts cannot read a club's photos. Unlinked historical players use initials. Renaming a linked player preserves the account photo. The cash-game leaderboard opens the player's profile from its avatar; tapping the profile photo opens a viewer with 100–400% zoom, a slider, reset and scroll-to-pan. Photo failures do not prevent game history or account-name editing.

### Shared cash-game countdowns

Apply `20261001_cash_shot_clock.sql` after the existing migrations and before deploying the countdown interface. The authenticated `poker_cash_timer(action, args)` RPC reads countdown state and match counts separately from club snapshots, and starts or stops a countdown without changing game revisions or buy-in data. Every operation rechecks the caller's current approved membership and game access. The owner, game organizers and approved accounts linked to participants in the active game can start or stop its clock; this right does not grant permission to edit chips, buy-ins or results. Players without accounts can be timed by an eligible account.

In Buy-ins and settlement, tapping a player's name opens 30-second (pre-flop, flop or turn) and 60-second (river) choices. Only one countdown can run per game. Its server deadline and version are shared across devices, with small independent reads while the app is visible; reconnecting or refreshing restores the current clock. Simultaneous starts accept only one request, and unique request identifiers prevent retries from creating another count. Finishing a game or removing its timed player ends the clock while retaining its usage history.

Each accepted start increments the timed player's count once, including clocks stopped early. `Timed N×` appears beneath player names and in that match's saved results, including player-profile game details; it does not affect points ordering or lifetime leaderboard totals. Attribution follows player renames and account linking and remains in the match history when membership changes. Older completed games remain untracked and show no invented timing statistics. The initiating phone alone attempts an expiry beep; screens stay awake where supported while a countdown runs. Visible expiry remains available when the browser cannot play sound or keep the screen awake. Starting and stopping require a connection, and no penalties are applied automatically.

Countdown browser checks use separate owner and two ordinary-member sessions: both durations, shared Stop, refreshed pages, expiry, buy-in saves during a running clock, automatic stop at game completion, retained match counts and descending result order. Mobile layout is checked at 390 pixels wide. Automated cases additionally cover simultaneous starts, uncertain-response retries, delayed responses, reconnection, starter-only sound ownership, rename/link/remove/re-add attribution and missing access. Physical-phone sound and wake behavior still require device checks.

Run `pnpm install` and `pnpm test`. The database suite executes the migration and RPC in PGlite (PostgreSQL), including pending/approved/revoked access, privilege escalation, cross-club isolation, unique bindings, personal-data preservation, and stale-write rejection. Client tests cover role checks, scoped caches and serialized writes.

Run `pnpm preview:clubs` for an isolated in-memory PostgreSQL preview at `http://127.0.0.1:8093` (or set `PORT` to use another local port). Its owner/member/member2/organizer/pending links use synthetic test accounts only. The active cash-game fixture includes the owner and both ordinary members so separate browser sessions can exercise a shared clock while retaining their different editing permissions. This development server binds to localhost and does not contact production Supabase. Browser checks covered creation, personal/club switching, join requests, membership approval, player binding, standing grants and game saves; ordinary members had no history edit/delete controls.
