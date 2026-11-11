# E2E coverage, part A: the player side

Landing and open world, lobby views, rooms, matches (bots and several browser contexts), campaign,
replays, help, social, stats, settings. Admin tabs, the level editor, languages, themes
and account flows are part B ([COVERAGE.b.md](COVERAGE.b.md)).
Specs: `e2e/player/*.spec.ts`; run with `bash scripts/e2e.sh`.

Inventory (2026-10-30, **81 items**; plus 46 rows for views without a nav entry, flows, dialogs and error states), from the repo root:

```bash
{ grep -ho "key: '[A-Za-z]*Scene'" frontend/src/scenes/*.ts | sed "s/key: //;s/'//g;s/^/scene /"
  grep -o 'id="nav-[A-Za-z]*"' frontend/src/ui/LobbyUI.ts | sed 's/id="//;s/"//;s/^/view /'
  grep -ho "{ id: '[a-z-]*', label" frontend/src/ui/SettingsUI.ts frontend/src/ui/HelpUI.ts | sed "s/{ id: '//;s/', label//;s/^/tab /"
  grep -ho 'data-tab="[a-z]*"' frontend/src/ui/views/FriendsView.ts frontend/src/ui/HelpUI.ts | sed 's/data-tab="//;s/"//;s/^/tab /'
  sed -n '/interface ClientToServerEvents/,/^}/p' shared/src/types/socket-events.ts |
    grep -o "^  '[a-z]*:[A-Za-z]*'" | tr -d " '" | grep -v '^admin:\|^sim:' | sed 's/^/event /'
} | sort -u
```

Tests tagged `@global` change server-wide state (banner, imprint, active challenge, seasons,
open-world round time and AFK timeout); `scripts/e2e.sh` runs them after the rest, one at a time.

Roles: G guest, U user, M moderator, A admin. ✅ = `spec › test`; ❌ = not driven, with one reason:
(a) hardware/external account, (b) irreversible external effect, (c) covered at another layer,
(d) cannot be driven, (e) time-box overrun (TODO + estimate).

## Scenes

| Item | Roles | Coverage |
|---|---|---|
| scene BootScene | all | ✅ every spec (boots on each page load); `sweep.spec.ts › every lobby view renders for a guest` |
| scene MenuScene | G | ✅ `auth.spec.ts › landing offers guest play, login and register` |
| scene LobbyScene | U M A G | ✅ `sweep.spec.ts › every lobby view renders for a user` (and moderator, admin, guest) |
| scene GameScene | U G | ✅ `rooms.spec.ts › a solo match against a bot: HUD, bomb, game over, play again` |
| scene HUDScene | U G | ✅ `rooms.spec.ts › a solo match against a bot: HUD, bomb, game over, play again` |
| scene GameOverScene | U | ✅ `rooms.spec.ts › a solo match against a bot: HUD, bomb, game over, play again`, `rooms.spec.ts › two players: live list, join, ready, start, rematch vote`, `campaign.spec.ts › a completed level unlocks the next one` |
| scene LevelEditorScene | U | ✅ opening it: `maps.spec.ts › my maps: list, publish, delete; New Map opens the editor`; editing → part B |

## Lobby views

| Item | Roles | Coverage |
|---|---|---|
| view nav-openWorld | U M A G | ✅ `openworld.spec.ts › players in the world see each other; leave, cancel and re-join`, `openworld.spec.ts › the lobby Open World view shows round, players and standings` |
| view nav-rooms | U M A G | ✅ `rooms.spec.ts › create room form: cancel, then create a room with bots and leave it` |
| view nav-campaign | U M A | ✅ `campaign.spec.ts › solo level: HUD, pause, continue, restart, exit` |
| view nav-maps | U M A | ✅ `maps.spec.ts › my maps: list, publish, delete; New Map opens the editor` |
| view nav-challenge | U M A | ✅ `maps.spec.ts › weekly challenge: details, empty board, play creates the room` |
| view nav-friends | U M A | ✅ `social.spec.ts › friend requests: send, decline, cancel, accept, remove, block, unblock` |
| view nav-messages | U M A | ✅ `social.spec.ts › direct messages arrive live, with unread badge and read receipt` |
| view nav-party | U M A | ✅ `social.spec.ts › party: create, invite, accept, chat, follow into a room, kick, disband` |
| view nav-leaderboard | U M A | ✅ `stats.spec.ts › leaderboard links to profiles; add friend from a profile` |
| view nav-matchHistory | U M A | ✅ `stats.spec.ts › match history pages through older matches` |
| view nav-settings | U M A G | ✅ `settings.spec.ts › account: rename, change password` (+ the other settings tests) |
| view nav-help | U M A G | ✅ `help.spec.ts › a player gets every player tab and the guides load` |
| view nav-admin | M A (not U, G) | ✅ entry offered to staff only: `sweep.spec.ts › every lobby view renders for a moderator`, `sweep.spec.ts › every lobby view renders for an admin`, `sweep.spec.ts › every lobby view renders for a user`; tabs → part B |
| view nav-logout | U G | ✅ `auth.spec.ts › wrong password shows an error; logout returns to the landing page` |
| (no nav) profile view | U | ✅ `stats.spec.ts › own profile: stats and achievements`, `stats.spec.ts › a private profile hides from other players` |
| (no nav) create-room view | U | ✅ `rooms.spec.ts › create room form: cancel, then create a room with bots and leave it` |
| guest gets only Open World, Rooms, Settings, Help | G | ✅ `sweep.spec.ts › every lobby view renders for a guest` |

## Tabs

| Item | Roles | Coverage |
|---|---|---|
| tab account | U | ✅ `settings.spec.ts › account: rename, change password` |
| tab preferences | U | ✅ `settings.spec.ts › preferences: theme, art style, graphics, audio, lobby chat stick across reloads` |
| tab privacy | U | ✅ `settings.spec.ts › privacy: switches save and take effect for other players` |
| tab cosmetics | U | ✅ `settings.spec.ts › cosmetics: equip an owned item, locked ones cannot be picked` |
| tab getting-started | U | ✅ `help.spec.ts › a player gets every player tab and the guides load` |
| tab power-ups | U | ✅ `help.spec.ts › a player gets every player tab and the guides load` |
| tab game-modes | U | ✅ `help.spec.ts › a player gets every player tab and the guides load` |
| tab map-features | U | ✅ `help.spec.ts › a player gets every player tab and the guides load` |
| tab guides | U | ✅ `help.spec.ts › a player gets every player tab and the guides load` |
| tab level-editor | M (not U) | ✅ `help.spec.ts › staff get the level-editor and staff-docs tabs` |
| tab admin-docs | M (not U) | ✅ `help.spec.ts › staff get the level-editor and staff-docs tabs` |
| tab imprint | U | ✅ `help.spec.ts › the imprint tab shows the text an admin set` |
| tab friends | U | ✅ `social.spec.ts › friend requests: send, decline, cancel, accept, remove, block, unblock` |
| tab requests | U | ✅ `social.spec.ts › friend requests: send, decline, cancel, accept, remove, block, unblock` |
| tab blocked | U | ✅ `social.spec.ts › friend requests: send, decline, cancel, accept, remove, block, unblock` |

## Socket events (client to server, player side)

| Item | Coverage |
|---|---|
| event campaign:start | ✅ `campaign.spec.ts › solo level: HUD, pause, continue, restart, exit` |
| event campaign:input | ✅ `campaign.spec.ts › solo level: HUD, pause, continue, restart, exit` |
| event campaign:pause | ✅ `campaign.spec.ts › solo level: HUD, pause, continue, restart, exit` |
| event campaign:resume | ✅ `campaign.spec.ts › solo level: HUD, pause, continue, restart, exit` |
| event campaign:quit | ✅ `campaign.spec.ts › solo level: HUD, pause, continue, restart, exit` |
| event dm:send | ✅ `social.spec.ts › direct messages arrive live, with unread badge and read receipt` |
| event dm:read | ✅ `social.spec.ts › direct messages arrive live, with unread badge and read receipt` |
| event friend:list | ✅ `social.spec.ts › friend requests: send, decline, cancel, accept, remove, block, unblock` |
| event friend:request | ✅ `social.spec.ts › friend requests: send, decline, cancel, accept, remove, block, unblock`, `stats.spec.ts › leaderboard links to profiles; add friend from a profile` |
| event friend:accept | ✅ `social.spec.ts › friend requests: send, decline, cancel, accept, remove, block, unblock` |
| event friend:decline | ✅ `social.spec.ts › friend requests: send, decline, cancel, accept, remove, block, unblock` |
| event friend:cancel | ✅ `social.spec.ts › friend requests: send, decline, cancel, accept, remove, block, unblock` |
| event friend:remove | ✅ `social.spec.ts › friend requests: send, decline, cancel, accept, remove, block, unblock` |
| event friend:block | ✅ `social.spec.ts › friend requests: send, decline, cancel, accept, remove, block, unblock` |
| event friend:unblock | ✅ `social.spec.ts › friend requests: send, decline, cancel, accept, remove, block, unblock` |
| event game:input | ✅ `rooms.spec.ts › a solo match against a bot: HUD, bomb, game over, play again` |
| event game:emote | ✅ `rooms.spec.ts › two players: live list, join, ready, start, rematch vote` |
| event game:spectatorChat | ✅ `rooms.spec.ts › spectating after death: banner, spectator chat and actions` |
| event spectator:action | ✅ `rooms.spec.ts › spectating after death: banner, spectator chat and actions` |
| event invite:room | ✅ `social.spec.ts › room invite from a friend; joining a friend from the friends list` |
| event invite:acceptRoom | ✅ `social.spec.ts › room invite from a friend; joining a friend from the friends list` |
| event invite:declineRoom | ✅ `social.spec.ts › room invite from a friend; joining a friend from the friends list` |
| event lobby:chat | ✅ `social.spec.ts › lobby chat reaches everyone in the lobby` |
| event lobby:subscribe | ✅ `rooms.spec.ts › two players: live list, join, ready, start, rematch vote` (the list updates without a reload) |
| event lobby:unsubscribe | ✅ `rooms.spec.ts › two players: live list, join, ready, start, rematch vote` (sent on entering the room) |
| event openworld:join | ✅ `openworld.spec.ts › players in the world see each other; leave, cancel and re-join` |
| event openworld:input | ✅ `openworld.spec.ts › a guest plays behind the landing and signs in from the HUD bar` |
| event openworld:leave | ✅ `openworld.spec.ts › players in the world see each other; leave, cancel and re-join` |
| event party:create | ✅ `social.spec.ts › party: create, invite, accept, chat, follow into a room, kick, disband` |
| event party:invite | ✅ `social.spec.ts › party: create, invite, accept, chat, follow into a room, kick, disband` |
| event party:acceptInvite | ✅ `social.spec.ts › party: create, invite, accept, chat, follow into a room, kick, disband` |
| event party:declineInvite | ✅ `social.spec.ts › party: create, invite, accept, chat, follow into a room, kick, disband` |
| event party:chat | ✅ `social.spec.ts › party: create, invite, accept, chat, follow into a room, kick, disband` |
| event party:kick | ✅ `social.spec.ts › party: create, invite, accept, chat, follow into a room, kick, disband` |
| event party:leave | ✅ `social.spec.ts › party: create, invite, accept, chat, follow into a room, kick, disband` (Leave Party, Disband) |
| event party:sync | ✅ `social.spec.ts › party: create, invite, accept, chat, follow into a room, kick, disband` (the party view syncs on open) |
| event rematch:vote | ✅ `rooms.spec.ts › two players: live list, join, ready, start, rematch vote` |
| event room:create | ✅ `rooms.spec.ts › create room form: cancel, then create a room with bots and leave it` |
| event room:join | ✅ `rooms.spec.ts › two players: live list, join, ready, start, rematch vote` |
| event room:leave | ✅ `rooms.spec.ts › create room form: cancel, then create a room with bots and leave it` |
| event room:ready | ✅ `rooms.spec.ts › two players: live list, join, ready, start, rematch vote` |
| event room:start | ✅ `rooms.spec.ts › a solo match against a bot: HUD, bomb, game over, play again` |
| event room:restart | ✅ `rooms.spec.ts › a solo match against a bot: HUD, bomb, game over, play again` |
| event room:setTeam | ✅ `rooms.spec.ts › teams: the host assigns teams the other player sees` |
| event room:setBotTeam | ✅ `rooms.spec.ts › teams: the host assigns teams the other player sees` |

## Cross-cutting flows, dialogs and error states

| Item | Roles | Coverage |
|---|---|---|
| register: required fields, invalid name, short password | G | ✅ `auth.spec.ts › register validates, then verify by mail and log in` |
| register: name taken (409) | G | ✅ `auth.spec.ts › register validates, then verify by mail and log in` |
| verify: verification screen, "not yet", resend | U | ✅ `auth.spec.ts › register validates, then verify by mail and log in` |
| verify: link from the mail (Mailpit) | U | ✅ `auth.spec.ts › register validates, then verify by mail and log in` |
| verify: bad token (redirect into the app, error message) | G | ✅ `auth.spec.ts › a bad verification link is refused` |
| login form, empty fields, wrong password | G | ✅ `auth.spec.ts › wrong password shows an error; logout returns to the landing page` |
| logout (session gone after reload) | U | ✅ `auth.spec.ts › wrong password shows an error; logout returns to the landing page` |
| forgot password, reset link, mismatch, single-use link | G | ✅ `auth.spec.ts › forgot password: reset link from the mail sets a new password` |
| 2FA: setup, wrong code, login with code, disable | U | ✅ `settings.spec.ts › account: two-factor login, then disable it` |
| language: landing picker, browser locale (de-AT) | G | ✅ `auth.spec.ts › the language picker switches the forms; a German browser starts in German` |
| language: settings, saved for the account | U | ✅ `settings.spec.ts › preferences: language switches the UI and is kept for the account` |
| theme, art style, quality, switches, volume, lobby-chat toggle | U | ✅ `settings.spec.ts › preferences: theme, art style, graphics, audio, lobby chat stick across reloads` |
| email change via mailed confirmation | U | ✅ `settings.spec.ts › account: email change confirmed through the mailed link` |
| change password: empty, mismatch, wrong current, success | U | ✅ `settings.spec.ts › account: rename, change password` |
| delete account (password required, cancel, confirm) | U | ✅ `settings.spec.ts › account: delete asks for the password, then the account is gone` |
| guest plays behind the landing; HUD login/register over the game | G | ✅ `openworld.spec.ts › a guest plays behind the landing and signs in from the HUD bar` |
| open world AFK kick | U | ✅ `openworld.spec.ts › an idle player is kicked out of the world after the AFK timeout` |
| open world round end overlay (standings, countdown, next round) | U | ✅ `openworld.spec.ts › a round ends: the standings overlay, then the next round` |
| leave dialog: cancel and confirm (world, match) | U | ✅ `openworld.spec.ts › players in the world see each other; leave, cancel and re-join`, `rooms.spec.ts › a solo match against a bot: HUD, bomb, game over, play again` |
| waiting room: back, settings panel, start disabled until ready | U | ✅ `rooms.spec.ts › two players: live list, join, ready, start, rematch vote` |
| custom map in Create Room (preview, generator options off, map named) | U | ✅ `maps.spec.ts › create room on a custom map: preview and the room names the map` |
| match HUD: player list, timer, stats, death banner | U | ✅ `rooms.spec.ts › a solo match against a bot: HUD, bomb, game over, play again` |
| spectator view after death | U | ✅ `rooms.spec.ts › spectating after death: banner, spectator chat and actions` |
| game over: Play Again (solo), rematch vote (two humans), Back to Lobby | U | ✅ `rooms.spec.ts › a solo match against a bot: HUD, bomb, game over, play again`, `rooms.spec.ts › two players: live list, join, ready, start, rematch vote`, `replay.spec.ts › replay a recorded match: play, pause, speed, seek, log, back` |
| game over: Elo, XP, level-up and achievement panels (canvas text) | U | ❌ (c) values from `tests/backend/services/elo.test.ts`, `achievements.test.ts`; the panels are canvas-only text |
| game modes from Create Room into a match (FFA: solo test; teams, battle royale, sudden death with maxed stats, deathmatch, KOTH) | U | ✅ `rooms.spec.ts › a Teams match starts against a bot`, `rooms.spec.ts › a Battle Royale match starts against a bot`, `rooms.spec.ts › a Sudden Death match starts against a bot`, `rooms.spec.ts › a Deathmatch match starts against a bot`, `rooms.spec.ts › a King of the Hill match starts against a bot` |
| engine rules: team win, BR zone, KOTH scoring, deathmatch respawn, power-ups, hazards, map events, puzzle tiles | U | ❌ (c) canvas-only, tested in the engine: `tests/backend/game/GameState.test.ts` (team win, KOTH scoring, zone init), `BattleRoyale.test.ts`, `ModeEdgeCases.test.ts` (deathmatch respawn), `{Player,PowerUp,PowerUpDrops}.test.ts`, `HazardTiles.test.ts`, `{MapEventPrune,EngineRegressions}.test.ts` (map events), `tests/shared/puzzle.test.ts`, `CampaignGame.test.ts` (puzzle tiles) |
| campaign: pause menu (continue, restart, exit) | U | ✅ `campaign.spec.ts › solo level: HUD, pause, continue, restart, exit` |
| campaign: level complete, results, progress unlocks next level | U | ✅ `campaign.spec.ts › a completed level unlocks the next one` |
| campaign: local co-op setup dialog, buddy setup dialog | U | ✅ `campaign.spec.ts › local co-op and buddy setup start a level` |
| campaign: online co-op for a party of two | U | ✅ `campaign.spec.ts › online co-op: a party of two plays a level together` |
| replay viewer: play/pause, speed, seek, log panel, back | M A | ✅ `replay.spec.ts › replay a recorded match: play, pause, speed, seek, log, back` |
| leaderboard: season select | U | ✅ `stats.spec.ts › a season with no games yet shows an empty leaderboard` |
| leaderboard: paging | U | ✅ `stats.spec.ts › leaderboard pages through the ranking` |
| profile: add friend, private profile (403 view) | U | ✅ `stats.spec.ts › leaderboard links to profiles; add friend from a profile`, `stats.spec.ts › a private profile hides from other players` |
| 404: unknown page (SPA fallback), unknown API route | G | ✅ `sweep.spec.ts › an unknown path falls back to the landing page` |
| 403: staff docs for a player | U | ✅ `help.spec.ts › a player gets every player tab and the guides load` |
| no page error / no 5xx anywhere | all | ✅ the `guard` fixture in `player/lib.ts` (every test, every page) |
| gamepad navigation (lobby, menus, emote wheel) | U | ❌ (d) the Gamepad API needs a device; Playwright cannot emulate one |
| sound output | U | ❌ (d) Web Audio output cannot be asserted; the mute/volume settings are covered |
| admin banner above every lobby view (live, after a reload, dismiss, cleared) | U | ✅ `banner.spec.ts › the admin banner shows above every lobby view, live and after a reload`; setting it in Admin > Announcements → part B |
| reconnect after a dropped connection (overlay, live again) | U | ✅ `rooms.spec.ts › the lobby reconnects after the connection drops and stays live` |
| lobby on a phone (drawer) | U | ❌ (c) `e2e/docs/tour.spec.ts › lobby on a phone`, `frontend/tests/ui/lobbyNavigation.test.ts` |
