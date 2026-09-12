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

The feature is implemented but defaults to `clubsEnabled: false` so deploying the frontend before its database migration cannot break existing sync.

1. Apply `supabase/migrations/20260913_clubs.sql` to the same Supabase project that hosts `texasholdem_user_states`.
2. Set `clubsEnabled: true` in `assets/js/00-supabase-config.js`, then deploy the frontend and service worker together.
3. Sign in as the intended club owner. In Settings, choose Personal records, check the history, then create the club.
4. Creation copies that account's latest server snapshot atomically. The original personal server row is retained. Subsequent club changes are independent of that backup.
5. Give members the club number. They submit a join request, optionally naming the player they want to bind to. The manager approves membership, then confirms the player binding and any game-management grant.

No production migration, real club creation or deployment is performed by the local implementation. No account is automatically made a manager based on an email string in source code.

## Data and permission boundaries

`poker_clubs` stores shared game state and a monotonically increasing revision. `poker_club_members` stores approval status, standing permission and player bindings. Both tables have RLS enabled and no direct authenticated/anonymous access. The authenticated `poker_club_action` RPC checks `auth.uid()` and current membership for each operation; frontend hiding is only a convenience.

All per-club mutation operations lock the club row. Saves must supply the revision read by the client; stale writes are rejected instead of replacing another device's changes. Client saves are serialized and capture the actor, club and payload before awaiting a response. Conflicts or permission failures freeze writes until a refresh. Export pending local changes before refreshing if they need to be retained.

Club mode requires a successful online authorization/read before displaying history and an online connection for writes. Revocation is enforced by the server on the next request. Previously viewed/exported copies cannot be remotely recalled. The UI refresh button reloads permissions and records; this version does not provide live realtime subscriptions.

Local caches are separated by authenticated user and club. Existing anonymous/local-mode data is kept under its original key. New account caches start empty; they do not automatically import another account's browser cache. Existing signed-in records restore from the personal server row. To move local-only records, export them from local mode and import explicitly into the intended personal account before creating its club.

Bindings currently reference existing player names to preserve the application's history format. A bound player cannot be renamed/deleted until the owner unbinds the account; historical names are handled by the existing roster rename flow. Club ownership transfer and multiple managers are not included in this first version.

## Verification

Run `pnpm install` and `pnpm test`. The database suite executes the migration and RPC in PGlite (PostgreSQL), including pending/approved/revoked access, privilege escalation, cross-club isolation, unique bindings, personal-data preservation, and stale-write rejection. Client tests cover role checks, scoped caches and serialized writes.

Run `pnpm preview:clubs` for an isolated in-memory PostgreSQL preview at `http://127.0.0.1:8093`. Its owner/member/organizer/pending links use synthetic test accounts only. This development server binds to localhost and does not contact production Supabase. Browser checks covered creation, personal/club switching, join requests, membership approval, player binding, standing grants and game saves; ordinary members had no history edit/delete controls.
