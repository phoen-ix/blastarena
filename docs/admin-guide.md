# BlastArena admin guide

What staff accounts can see and do in the Admin view, and how to do the everyday tasks there.

Audience: accounts with the **moderator** or **admin** role. Players are covered by the
[README](../README.md) and the in-game Help. Each admin screen is pictured in the
[screenshot gallery](screenshots/README.md#admin) (this file has no images because the in-game Help renders it); how the systems work underneath (endpoints,
settings keys, the simulation and AI pipelines) is in [Admin Panel & Systems](admin-and-systems.md).
Installation and the first admin account: [README → Quick Start](../README.md#quick-start).

**Contents:** [Roles and what they unlock](#roles-and-what-they-unlock) · [Giving someone a staff role](#giving-someone-a-staff-role) · [Managing accounts](#managing-accounts) · [Moderating live rooms](#moderating-live-rooms) · [Reviewing matches and replays](#reviewing-matches-and-replays) · [Sending announcements](#sending-announcements) · [Changing server settings](#changing-server-settings) · [Running seasons and rank tiers](#running-seasons-and-rank-tiers) · [Running map challenges](#running-map-challenges) · [Running bot simulations](#running-bot-simulations) · [Managing bot and enemy AIs](#managing-bot-and-enemy-ais) · [Editing the campaign](#editing-the-campaign) · [Editing achievements and cosmetics](#editing-achievements-and-cosmetics) · [Reading the audit log](#reading-the-audit-log) · [Backups and updates](#backups-and-updates)

## Roles and what they unlock

There are three roles: **user**, **moderator** and **admin**. Staff (moderator and admin) get an
**Admin** entry at the bottom of the lobby sidebar and two extra Help tabs, **Level Editor** and
**Admin Docs** (where this guide is shown in-game). Moderators see three of the twelve Admin tabs;
admins see all of them.

| What | Moderator | Admin | Checked by |
|------|-----------|-------|------------|
| Sidebar **Admin**, Help **Level Editor** and **Admin Docs** | yes | yes | `isStaff` in `LobbyUI` / `HelpUI`; `/api/docs/admin/*` behind `staffMiddleware` |
| **Users**: search and read the list | yes | yes | tab `adminOnly: false` (`AdminUI`); `GET /admin/users` behind `staffMiddleware` |
| **Users**: every change (create, role, deactivate, passwords, 2FA, sessions, delete, cleanup) | no (buttons hidden) | yes | `role === 'admin'` in `UsersTab`; `adminOnlyMiddleware` |
| **Matches**: list, details, replays | yes | yes | `staffMiddleware` |
| **Matches**: delete | no | yes | `isAdmin` in `MatchesTab`; `adminOnlyMiddleware` |
| **Rooms**: list, spectate, message, kick | yes | yes | socket `admin:spectate` / `admin:roomMessage` / `admin:kick` accept admin or moderator |
| **Rooms**: close | no | yes | socket `admin:closeRoom` accepts admin only |
| **Dashboard**, **Logs**, **Simulations**, **AI**, **Announcements**, **Campaign**, **Seasons**, **Achievements**, **Challenges** | no (tabs hidden) | yes | `adminOnly: true` in `AdminUI`; `adminOnlyMiddleware` on every route, `sim:*` sockets admin only |
| Chat features set to **Staff Only** | yes | yes | role check in the chat socket handlers |
| Chat features set to **Admin Only** | no | yes | same |

The server reads the role from the database on every admin request (not from the login token), so a
demoted or deactivated account loses access with its next request.

Some actions are refused even for admins: you cannot change your own role, deactivate or delete
yourself. **Revoke All Sessions** logs out everyone except you, and **Account Cleanup** never
touches admin or moderator accounts.

## Giving someone a staff role

The very first admin is promoted in the database: [README → First admin](../README.md#first-admin).
After that:

1. Open **Admin** → **Users** and search for the account.
2. In the **Actions** column, pick **moderator** or **admin** (or **user** to demote) in the role
   list.
3. Confirm the **Change Role** dialog with **Confirm**. Cancelling puts the list back to the old
   role.

## Managing accounts

**Admin** → **Users** lists 20 accounts per page with **Username**, **Email** (a masked hint; the
full address is not stored readably), **Role**, **Status**, **2FA**, **Matches**, **Wins**,
**Joined** and **Last Login**. Type in **Search by username or email...** to filter. Moderators see
the same table without the action buttons.

### Creating an account

1. Click **Create User**.
2. Fill in **Username** (3–20 characters, letters, digits, `-` and `_`), **Email**, **Password**
   (at least 8 characters) and pick a **Role**.
3. Click **Create**. The account is verified at once, so it can play without the email step. This
   works even when **User Registration** is switched off on the Dashboard.

### Locking an account

There is no separate ban: **Deactivate** is the lock.

1. Click **Deactivate** in the user's row and confirm. The user is logged out on every device at
   once and cannot sign in again.
2. To lift it, click **Reactivate** (no confirmation).

Deactivated accounts stay in the database with their stats; to remove them for good, delete them or
run an [account cleanup](#cleaning-up-old-accounts).

### Resetting a password, 2FA or sessions

- **Reset PW**: enter **New Password** and **Confirm Password** (at least 8 characters) and click
  **Reset Password**. The user is logged out and signs in with the new password.
- **Reset 2FA** (only shown when the **2FA** column says **Enabled**): turns two-factor
  authentication off, for a user who lost their authenticator and backup codes. They can set it up
  again in Settings.
- **Revoke Sessions**: logs the user out on every device without changing anything else.

### Deleting an account

Click **Delete** and confirm **Delete User Permanently**. The account and all its data go; this
cannot be undone. Players can also delete their own account in Settings → Account.

### Cleaning up old accounts

1. Click **Account Cleanup**.
2. Pick a type: **Unverified** (never confirmed their email), **Inactive** (no login for the
   period) or **Deactivated**.
3. For Unverified and Inactive, enter **Older than (days)**.
4. Click **Preview** to see how many accounts match.
5. Type `DELETE` and click **Delete N accounts**.

Only accounts with the **user** role are ever included, and never your own.

## Moderating live rooms

**Admin** → **Rooms** lists every open room with **Code**, **Name**, **Mode**, **Players** and
**Status** (waiting or playing); it updates live. **Players** shows the count and each player's
name and user ID (`#42`), each with its own **Kick** button.

- **Spectate**: watch a running match (a waiting room has nothing to show yet). Press Escape, or
  Start on a gamepad, to come back to the Rooms tab.
- **Message**: type a message and click **Send**; everyone in the room, waiting or playing, sees it.
- **Kick** (next to a player): enter an optional **Reason**, then click **Kick**. The player is
  removed at once and gets the reason.
- **Close** (admins only): confirm **Close Room** to end the room and remove every player.

## Reviewing matches and replays

**Admin** → **Matches** is the match history (ID, room code, mode, players, duration, winner,
status, start time). Click a row for the details: map size and seed, timings, and every player's
placement, team and kills. When the match was recorded, **Watch Replay** opens it in the replay
viewer; closing the viewer brings you back. The replay controls are described in the
[Replay System](replay-system.md) guide.

Admins also get **Delete** per row and **Delete All Matches**; both remove the replay files too and
ask for confirmation. Whether new matches are recorded at all is the **Match Recordings** switch on
the Dashboard.

## Sending announcements

**Admin** → **Announcements** has two tools:

- **Broadcast Toast**: type up to 500 characters and click **Send Toast**. Every connected player
  sees a notification that disappears after a few seconds. A preview shows under the field as you
  type.
- **Persistent Banner**: type up to 1000 characters and click **Set Banner**. The banner stays at
  the top of the lobby for everyone until you click **Clear Banner**.

Both are limited to 10 sends per minute.

## Changing server settings

**Admin** → **Dashboard** starts with five live counters (**Total Users**, **Active (24h)**,
**Total Matches**, **Active Rooms**, **Online Players**), then **Server Settings**. Switches and
lists save as soon as you change them; fields with a button save when you click it. Open clients get
most changes live.

| Setting | What it does |
|---------|--------------|
| **Match Recordings** | Record replays of new matches. |
| **User Registration** | Off hides the Register link and refuses sign-ups; Create User still works. |
| **Spectator Game Master (global)** | Lets dead players spend energy on the live match (rooms can still turn it off). |
| **Party Chat**, **Lobby Chat**, **Direct Messages**, **In-Game Emotes**, **Spectator Chat** | Who may use each: **Everyone**, **Staff Only (Admin + Mod)**, **Admin Only** or **Disabled**. |
| **XP Multiplier** | 0 to 10, click **Save**. |
| **Default Theme**, **Default Art Style** | What players see until they pick their own in Settings. |
| **Display GitHub Link**, **Display Imprint** | Links in the login footer and on the Help tab bar; edit the text in **Imprint Text** and click **Save Imprint**. |
| **Open World** | **Enabled**, **Guest Access**, **Max Players**, **Round Time (s)**, **Map Width**/**Map Height** (odd numbers), **Wall Density**, **Respawn Delay (s)**, **AFK Timeout (s)** (0–600, 0 = disabled); click **Save Open World Settings**. |
| **Email / SMTP Settings** | Host, port, user, password, **Security** (**STARTTLS (required)**, **TLS (implicit)** or **None (plaintext)**, only for a local mail catcher; unset it follows the port: TLS on 465, else STARTTLS), **EHLO Name** (empty: the From Email domain), sender; **Save**, **Reset to Defaults** (back to the `.env` values, Security from the port, EHLO from the sender) and **Send Test** to an address you enter. |
| **Game Creation Defaults**, **Simulation Defaults** | Expand to preset the Create Room and New Simulation forms; **Save** or **Reset to Defaults**. |

At the bottom, **Danger Zone** → **Revoke All Sessions** logs out every user except you: type
`CONFIRM` and click **Revoke All**.

## Running seasons and rank tiers

A season is a dated stretch with its own Elo; ending it resets everyone's rating.

1. **Admin** → **Seasons** → **Create Season**: enter **Name**, **Start Date** and **End Date**, then
   **Create**.
2. Click **Activate** on the season and confirm. Any other active season is deactivated.
3. When it is over, click **End Season** and choose:
   - **Soft Reset**: every rating moves halfway back to 1000.
   - **Hard Reset**: every rating goes back to 1000.
4. **Delete** removes an inactive season; an active one must be ended first.

Under **Rank Tier Configuration** each tier has a name, a min and max Elo and a colour. Use
**+ Add Tier** or × to change the list, tick **Enable sub-tiers (I / II / III)** if wanted, and
click **Save Rank Configuration**.

## Running map challenges

A challenge features one published community map for a period, with its own leaderboard.

1. **Admin** → **Challenges**: make sure **Challenges Enabled** under **Challenge System** is on
   (it switches the whole feature for players).
2. Click **Create Challenge**, fill in **Title**, **Description**, **Map** (published maps only),
   **Game Mode**, **Start Date** and **End Date** (default: today and a week later), and click
   **Create Challenge**.
3. Click ✓ (**Activate**) in its row. Only one challenge is active at a time; activating one
   deactivates the others. × deactivates it.
4. − deletes a challenge after confirmation.

There is no edit button: to change a challenge, delete it and create it again. A map that belongs to
an active or upcoming challenge cannot be deleted by its creator.

## Running bot simulations

Simulations play bot-only matches in bulk, for testing AIs and balance. They create no match
history.

1. **Admin** → **Simulations** → **New Simulation**.
2. Choose **Game Mode**, **Bot Count**, **Bot Difficulty**, **Bot AI** (when several are active),
   map and power-up options, **Total Games** (1–1000), **Speed** (**Fast (max speed)** or
   **Real-time (20 tps)**) and **Log Verbosity**. The Dashboard's **Simulation Defaults** prefill
   this form.
3. Click **Start Batch**. One batch runs at a time; up to ten more wait in a queue (**Remove** takes
   one out).
4. **View** a batch for progress, the win distribution and per-game results. **Spectate Current
   Game** works for real-time batches; Escape returns to the batch. **Cancel Batch** stops it and
   keeps the finished games. Each game with a recording has a **Replay** button.
5. **Delete** (not shown while a batch runs) removes it with its logs and replays.

## Managing bot and enemy AIs

**Admin** → **AI** has two lists: **Bot AI Management** (match bots) and **Enemy AI Management**
(campaign enemies).

1. Click **Upload New AI** (or **Upload New Enemy AI**), give it a **Name**, an optional
   **Description**, choose the `.ts` file and click **Upload & Compile**. A file that fails the
   safety checks is refused with the reason.
2. **Activate**/**Deactivate** decides whether it can be picked; **Edit** changes name and
   description, **Re-upload** replaces the source, **Download** gets it back.
3. **Delete** asks you to type the AI's name. Games using a deleted bot AI fall back to the
   built-in one; enemies fall back to their movement pattern.

The built-in bot AI can be deactivated but not deleted. Writing an AI:
[Bot AI guide](bot-ai-guide.md), [Enemy AI guide](enemy-ai-guide.md).

## Editing the campaign

**Admin** → **Campaign** has three views: **Worlds & Levels**, **Enemy Types** and **Replays**.

- **Create World**, then expand it and click **Add Level**: the level opens in the visual level
  editor; **Edit** reopens it. Closing the editor returns to this tab.
- Worlds and levels stay hidden from players until you click **Publish**; the arrows change the
  world order.
- **Export**/**Bundle** and **Import Level** move levels between servers as JSON (a bundle carries
  its enemy types along).
- **Enemy Types**: **Create Enemy Type** sets stats, movement, an optional **Custom AI** and the
  look; **Export**/**Import Enemy Type** as JSON.
- **Replays**: **Watch** or **Delete** recorded campaign runs.
- Deleting a world, level or enemy type asks you to type its name.

Level design, tiles and enemy behaviour: [Campaign System](campaign.md).

## Editing achievements and cosmetics

**Admin** → **Achievements** switches between **Achievements** and **Cosmetics**.

- **Create Achievement**: name, description, icon, category, a **Condition Type** (**Cumulative**,
  **Per Game**, **Mode Specific**, **Campaign**) with its fields, and an optional reward (a cosmetic
  or a title).
- **Create Cosmetic**: name, **Type** (colour, eyes, trail, bomb skin), rarity and how it unlocks.
- **Export**, **Export All** and **Import** move achievements (with the cosmetics they reward) as
  JSON; on import you choose for each cosmetic whether to create it, use an existing one or skip
  it.
- **Delete** asks you to type the name.

## Reading the audit log

**Admin** → **Logs** lists admin actions with **Date**, **Admin**, **Action**, **Target Type**,
**Target ID** and **Details**, newest first. Click a row to read the full details.
**Filter by action** narrows the list to one kind of action: it offers every action the server
records (accounts, announcements, settings, matches and replays, room kicks, closes and messages,
simulations, seasons, achievements, cosmetics, challenges, campaign worlds, levels and enemy types,
bot and enemy AIs); **All** shows everything. Reordering a world or level is recorded as **Edit
World** or **Edit Level**. Settings changes are recorded as **Update Setting**,
rank tier changes as **Update Rank Tiers**.

## Backups and updates

These are server tasks, outside the app.

- **What to back up:** the database, plus the bind-mounted folders under `./data/` that hold
  replays, simulation logs, game logs and uploaded AIs ([Data Persistence](infrastructure.md#data-persistence)).
  `data/redis` holds only short-lived state.
- **Database dump:**
  `docker compose exec -T db sh -c 'mariadb-dump -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' > blast_arena.sql`
- **Updating:** pull the new version and run `docker compose up --build -d`. Database migrations
  run by themselves when the backend starts ([Database Migrations](infrastructure.md#database-migrations)).
  Before a MariaDB major-version bump, dump first: [README → Upgrading MariaDB](../README.md#upgrading-mariadb).
