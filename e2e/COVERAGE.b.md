# E2E coverage — part b

Part b of the split Wave 2 suite: admin tabs (all 12), the level editor, the 12 interface
languages, the 11 themes and the account flows (register, verify, reset, 2FA, Settings > Account).
Part a (player side: landing, lobby views, rooms, matches, open world, social, stats) is mapped in
`COVERAGE.md`. Specs: `e2e/b/*.spec.ts`, run by `scripts/e2e.sh` (all of `e2e/`) or
`bash scripts/e2e.sh b/` (this part only).

- **Extraction:** `bash e2e/b/inventory.sh` (admin tab ids from `AdminUI.ts`; every `ApiClient` call
  (endpoints held in `const endpoint(s)` or passed to `downloadExport` resolved) and `admin:`/`sim:`
  socket event in `frontend/src/ui/admin/*.ts`; editor tools and actions from `LevelEditorScene.ts`
  plus the campaign Theme Hazards (`HAZARD_TILE_NAMES`) and their "Show all themes" toggle; the
  `/auth/*` and `/user/*` account routes; `supportedLngs`; `THEME_IDS`).
- **Date:** 2026-10-31 · **Items:** 218 (+ 24 cross-cutting rows below)
- **Status:** ✅ 218 · ❌ 0
- Tests tagged `@global` change server-wide settings (registration, chat modes, defaults, seasons,
  challenges, announcements, revoke-all, delete-all) or hold the server's one simulation slot:
  `scripts/e2e.sh` runs them after the rest with one worker, so they cannot pull the rug from under
  parallel specs.


## Admin tabs (as admin; staff tabs also as moderator)

| Item | | Test (`spec › title`) or reason |
|---|---|---|
| `dashboard` | ✅ | admin-sweep.spec.ts › an admin opens all 12 tabs |
| `users` | ✅ | admin-sweep.spec.ts › an admin opens all 12 tabs; admin-sweep.spec.ts › a moderator gets the staff tabs and nothing admin-only |
| `matches` | ✅ | admin-sweep.spec.ts › an admin opens all 12 tabs; admin-sweep.spec.ts › a moderator gets the staff tabs and nothing admin-only |
| `rooms` | ✅ | admin-sweep.spec.ts › an admin opens all 12 tabs; admin-sweep.spec.ts › a moderator gets the staff tabs and nothing admin-only |
| `logs` | ✅ | admin-sweep.spec.ts › an admin opens all 12 tabs |
| `simulations` | ✅ | admin-sweep.spec.ts › an admin opens all 12 tabs |
| `ai` | ✅ | admin-sweep.spec.ts › an admin opens all 12 tabs |
| `announcements` | ✅ | admin-sweep.spec.ts › an admin opens all 12 tabs (moderator: no tab, admin-sweep.spec.ts › a moderator gets the staff tabs and nothing admin-only) |
| `campaign` | ✅ | admin-sweep.spec.ts › an admin opens all 12 tabs |
| `seasons` | ✅ | admin-sweep.spec.ts › an admin opens all 12 tabs |
| `achievements` | ✅ | admin-sweep.spec.ts › an admin opens all 12 tabs |
| `challenges` | ✅ | admin-sweep.spec.ts › an admin opens all 12 tabs |

## Admin actions (REST calls and socket events of `frontend/src/ui/admin/*.ts`)

| Item | | Test (`spec › title`) or reason |
|---|---|---|
| `delete /admin/achievements/:x` | ✅ | admin-content.spec.ts › achievements: create, edit, export, delete |
| `delete /admin/ai/:x` | ✅ | admin-ai.spec.ts › bot AI: refused source, upload, toggle, edit, re-upload, download, delete |
| `delete /admin/announcements/banner` | ✅ | admin-users.spec.ts › announcements: a toast reaches players, a banner stays until cleared |
| `delete /admin/campaign/enemy-types/:x` | ✅ | admin-campaign.spec.ts › enemy types: create, edit, export, delete, import, and the replays view |
| `delete /admin/campaign/levels/:x` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete |
| `delete /admin/campaign-replays/:x` | ✅ | admin-campaign.spec.ts › campaign replays: a lost run is listed, watched and deleted |
| `delete /admin/campaign/worlds/:x` | ✅ | admin-campaign.spec.ts › worlds: create, edit, reorder, publish, delete |
| `delete /admin/challenges/:x` | ✅ | admin-content.spec.ts › challenges: toggle, create, activate, deactivate, delete |
| `delete /admin/cosmetics/:x` | ✅ | admin-content.spec.ts › cosmetics: create, edit, export, delete, import |
| `delete /admin/enemy-ai/:x` | ✅ | admin-ai.spec.ts › enemy AI: upload, toggle, re-upload, download, delete |
| `delete /admin/matches` | ✅ | admin-games.spec.ts › delete all matches |
| `delete /admin/matches/:x` | ✅ | admin-games.spec.ts › match history: details and delete |
| `delete /admin/seasons/:x` | ✅ | admin-content.spec.ts › seasons: create, activate, end with a soft reset, delete |
| `delete /admin/simulations/:x` | ✅ | admin-ai.spec.ts › simulations: run a fast batch, read the results, watch a replay, delete it |
| `delete /admin/users/:x` | ✅ | admin-users.spec.ts › delete a user |
| `download /admin/ai/:x/download` | ✅ | admin-ai.spec.ts › bot AI: refused source, upload, toggle, edit, re-upload, download, delete |
| `download /admin/enemy-ai/:x/download` | ✅ | admin-ai.spec.ts › enemy AI: upload, toggle, re-upload, download, delete |
| `get /admin/achievements` | ✅ | admin-content.spec.ts › achievements: create, edit, export, delete |
| `get /admin/achievements/export-all` | ✅ | admin-content.spec.ts › achievements: create, edit, export, delete |
| `get /admin/achievements/:x/export` | ✅ | admin-content.spec.ts › achievements: create, edit, export, delete |
| `get /admin/actions` | ✅ | admin-users.spec.ts › logs list the admin actions and filter by type |
| `get /admin/ai` | ✅ | admin-ai.spec.ts › bot AI: refused source, upload, toggle, edit, re-upload, download, delete |
| `get /admin/ai/active` | ✅ | admin-sweep.spec.ts › an admin opens all 12 tabs (Dashboard and Simulations load it) |
| `get /admin/announcements/banner` | ✅ | admin-users.spec.ts › announcements: a toast reaches players, a banner stays until cleared |
| `get /admin/campaign/enemy-types` | ✅ | admin-campaign.spec.ts › enemy types: create, edit, export, delete, import, and the replays view |
| `get /admin/campaign/enemy-types/:x/export` | ✅ | admin-campaign.spec.ts › enemy types: create, edit, export, delete, import, and the replays view |
| `get /admin/campaign/levels` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete |
| `get /admin/campaign/levels/:x/export` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete (the level row's Export) |
| `get /admin/campaign/levels/:x/export-bundle` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete (the level row's Bundle) |
| `get /admin/campaign-replays` | ✅ | admin-campaign.spec.ts › enemy types: create, edit, export, delete, import, and the replays view; admin-campaign.spec.ts › campaign replays: a lost run is listed, watched and deleted |
| `get /admin/campaign-replays/:x` | ✅ | admin-campaign.spec.ts › campaign replays: a lost run is listed, watched and deleted |
| `get /admin/campaign/worlds` | ✅ | admin-campaign.spec.ts › worlds: create, edit, reorder, publish, delete |
| `get /admin/challenges` | ✅ | admin-content.spec.ts › challenges: toggle, create, activate, deactivate, delete |
| `get /admin/cosmetics` | ✅ | admin-content.spec.ts › cosmetics: create, edit, export, delete, import |
| `get /admin/cosmetics/:x/export` | ✅ | admin-content.spec.ts › cosmetics: create, edit, export, delete, import |
| `get /admin/enemy-ai` | ✅ | admin-ai.spec.ts › enemy AI: upload, toggle, re-upload, download, delete |
| `get /admin/enemy-ai/active` | ✅ | admin-campaign.spec.ts › enemy types: create, edit, export, delete, import, and the replays view (the enemy modal loads it) |
| `get /admin/matches` | ✅ | admin-games.spec.ts › match history: details and delete |
| `get /admin/matches/:x` | ✅ | admin-games.spec.ts › match history: details and delete |
| `get /admin/replays/:x` | ✅ | admin-games.spec.ts › a played match: details, watch its replay, back to Matches |
| `get /admin/rooms` | ✅ | admin-games.spec.ts › message, kick and close a waiting room |
| `get /admin/seasons` | ✅ | admin-content.spec.ts › seasons: create, activate, end with a soft reset, delete |
| `get /admin/settings/challenges_enabled` | ✅ | admin-content.spec.ts › challenges: toggle, create, activate, deactivate, delete |
| `get /admin/settings/default_art_style` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload (the Dashboard loads it; reload re-reads it) |
| `get /admin/settings/default_theme` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload (the Dashboard loads it; reload re-reads it) |
| `get /admin/settings/display_github` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload (the Dashboard loads it; reload re-reads it) |
| `get /admin/settings/dm_mode` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload (the Dashboard loads it; reload re-reads it) |
| `get /admin/settings/email_settings` | ✅ | admin-dashboard.spec.ts › email settings: save, send a test mail, reset |
| `get /admin/settings/emote_mode` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload (the Dashboard loads it; reload re-reads it) |
| `get /admin/settings/game_defaults` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload (the Dashboard loads it; reload re-reads it) |
| `get /admin/settings/imprint` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload (the Dashboard loads it; reload re-reads it) |
| `get /admin/settings/lobby_chat_mode` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload (the Dashboard loads it; reload re-reads it) |
| `get /admin/settings/open_world` | ✅ | admin-dashboard.spec.ts › open world settings save |
| `get /admin/settings/party_chat_mode` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload (the Dashboard loads it; reload re-reads it) |
| `get /admin/settings/rank_tiers` | ✅ | admin-content.spec.ts › rank tiers: add a tier, validate, save |
| `get /admin/settings/recordings_enabled` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload (the Dashboard loads it; reload re-reads it) |
| `get /admin/settings/registration_enabled` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload (the Dashboard loads it; reload re-reads it) |
| `get /admin/settings/simulation_defaults` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload (the Dashboard loads it; reload re-reads it) |
| `get /admin/settings/spectator_actions_enabled` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload (the Dashboard loads it; reload re-reads it) |
| `get /admin/settings/spectator_chat_mode` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload (the Dashboard loads it; reload re-reads it) |
| `get /admin/settings/xp_multiplier` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload (the Dashboard loads it; reload re-reads it) |
| `get /admin/simulations` | ✅ | admin-ai.spec.ts › simulations: run a fast batch, read the results, watch a replay, delete it |
| `get /admin/simulations/:x` | ✅ | admin-ai.spec.ts › simulations: run a fast batch, read the results, watch a replay, delete it |
| `get /admin/simulations/:x/replay/:x` | ✅ | admin-ai.spec.ts › simulations: run a fast batch, read the results, watch a replay, delete it |
| `get /admin/stats` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload (stat cards) |
| `get /admin/users` | ✅ | admin-users.spec.ts › search and create a user |
| `get /maps/published` | ✅ | admin-content.spec.ts › challenges: toggle, create, activate, deactivate, delete |
| `post /admin/achievements` | ✅ | admin-content.spec.ts › achievements: create, edit, export, delete |
| `post /admin/achievements/import` | ✅ | admin-content.spec.ts › achievements: create, edit, export, delete |
| `post /admin/announcements/banner` | ✅ | admin-users.spec.ts › announcements: a toast reaches players, a banner stays until cleared |
| `post /admin/announcements/toast` | ✅ | admin-users.spec.ts › announcements: a toast reaches players, a banner stays until cleared |
| `post /admin/campaign/enemy-types` | ✅ | admin-campaign.spec.ts › enemy types: create, edit, export, delete, import, and the replays view |
| `post /admin/campaign/enemy-types/import` | ✅ | admin-campaign.spec.ts › enemy types: create, edit, export, delete, import, and the replays view |
| `post /admin/campaign/levels` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete |
| `post /admin/campaign/levels/import` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete |
| `post /admin/campaign/worlds` | ✅ | admin-campaign.spec.ts › worlds: create, edit, reorder, publish, delete |
| `post /admin/challenges` | ✅ | admin-content.spec.ts › challenges: toggle, create, activate, deactivate, delete |
| `post /admin/challenges/:x/activate` | ✅ | admin-content.spec.ts › challenges: toggle, create, activate, deactivate, delete |
| `post /admin/challenges/:x/deactivate` | ✅ | admin-content.spec.ts › challenges: toggle, create, activate, deactivate, delete |
| `post /admin/cosmetics` | ✅ | admin-content.spec.ts › cosmetics: create, edit, export, delete, import |
| `post /admin/cosmetics/import` | ✅ | admin-content.spec.ts › cosmetics: create, edit, export, delete, import |
| `post /admin/revoke-all-sessions` | ✅ | admin-dashboard.spec.ts › revoke all sessions: typed confirmation, then everyone is signed out |
| `post /admin/seasons` | ✅ | admin-content.spec.ts › seasons: create, activate, end with a soft reset, delete |
| `post /admin/seasons/:x/activate` | ✅ | admin-content.spec.ts › seasons: create, activate, end with a soft reset, delete |
| `post /admin/seasons/:x/end` | ✅ | admin-content.spec.ts › seasons: create, activate, end with a soft reset, delete |
| `post /admin/settings/email_settings/test` | ✅ | admin-dashboard.spec.ts › email settings: save, send a test mail, reset |
| `post /admin/users` | ✅ | admin-users.spec.ts › search and create a user |
| `post /admin/users/cleanup/execute` | ✅ | admin-users.spec.ts › account cleanup previews and deletes old unverified accounts |
| `post /admin/users/cleanup/preview` | ✅ | admin-users.spec.ts › account cleanup previews and deletes old unverified accounts |
| `post /admin/users/:x/reset-totp` | ✅ | admin-users.spec.ts › reset 2FA from the users table |
| `post /admin/users/:x/revoke-sessions` | ✅ | admin-users.spec.ts › reset a password and revoke sessions |
| `postForm /admin/ai` | ✅ | admin-ai.spec.ts › bot AI: refused source, upload, toggle, edit, re-upload, download, delete |
| `postForm /admin/enemy-ai` | ✅ | admin-ai.spec.ts › enemy AI: upload, toggle, re-upload, download, delete |
| `put /admin/achievements/:x` | ✅ | admin-content.spec.ts › achievements: create, edit, export, delete |
| `put /admin/ai/:x` | ✅ | admin-ai.spec.ts › bot AI: refused source, upload, toggle, edit, re-upload, download, delete |
| `put /admin/campaign/enemy-types/:x` | ✅ | admin-campaign.spec.ts › enemy types: create, edit, export, delete, import, and the replays view |
| `put /admin/campaign/levels/:x` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete |
| `put /admin/campaign/levels/:x/order` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete |
| `put /admin/campaign/worlds/:x` | ✅ | admin-campaign.spec.ts › worlds: create, edit, reorder, publish, delete |
| `put /admin/campaign/worlds/:x/order` | ✅ | admin-campaign.spec.ts › worlds: create, edit, reorder, publish, delete |
| `put /admin/cosmetics/:x` | ✅ | admin-content.spec.ts › cosmetics: create, edit, export, delete, import |
| `put /admin/enemy-ai/:x` | ✅ | admin-ai.spec.ts › enemy AI: upload, toggle, re-upload, download, delete |
| `put /admin/settings/challenges_enabled` | ✅ | admin-content.spec.ts › challenges: toggle, create, activate, deactivate, delete |
| `put /admin/settings/default_art_style` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload |
| `put /admin/settings/default_theme` | ✅ | themes.spec.ts › the admin default theme applies to browsers without a choice |
| `put /admin/settings/display_github` | ✅ | admin-dashboard.spec.ts › imprint and GitHub link appear on the sign-in form |
| `put /admin/settings/email_settings` | ✅ | admin-dashboard.spec.ts › email settings: save, send a test mail, reset |
| `put /admin/settings/game_defaults` | ✅ | admin-dashboard.spec.ts › game creation defaults save and reset |
| `put /admin/settings/imprint` | ✅ | admin-dashboard.spec.ts › imprint and GitHub link appear on the sign-in form |
| `put /admin/settings/open_world` | ✅ | admin-dashboard.spec.ts › open world settings save |
| `put /admin/settings/party_chat_mode` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload |
| `put /admin/settings/rank_tiers` | ✅ | admin-content.spec.ts › rank tiers: add a tier, validate, save |
| `put /admin/settings/recordings_enabled` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload |
| `put /admin/settings/registration_enabled` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload; account.spec.ts › register and verify › with registration off there is no way to register |
| `put /admin/settings/simulation_defaults` | ✅ | admin-dashboard.spec.ts › simulation defaults save and reset |
| `put /admin/settings/spectator_actions_enabled` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload |
| `put /admin/settings/:x` | ✅ | admin-dashboard.spec.ts › toggles and chat modes save and survive a reload (lobby/DM/emote/spectator chat modes) |
| `put /admin/settings/xp_multiplier` | ✅ | admin-dashboard.spec.ts › XP multiplier is range-checked and saved |
| `put /admin/users/:x/deactivate` | ✅ | admin-users.spec.ts › deactivate and reactivate |
| `put /admin/users/:x/password` | ✅ | admin-users.spec.ts › reset a password and revoke sessions |
| `put /admin/users/:x/role` | ✅ | admin-users.spec.ts › change a role, with confirmation |
| `putForm /admin/ai/:x/upload` | ✅ | admin-ai.spec.ts › bot AI: refused source, upload, toggle, edit, re-upload, download, delete (Re-upload) |
| `putForm /admin/enemy-ai/:x/upload` | ✅ | admin-ai.spec.ts › enemy AI: upload, toggle, re-upload, download, delete (Re-upload) |
| `socket admin:closeRoom` | ✅ | admin-games.spec.ts › message, kick and close a waiting room |
| `socket admin:kick` | ✅ | admin-games.spec.ts › message, kick and close a waiting room |
| `socket admin:roomMessage` | ✅ | admin-games.spec.ts › message, kick and close a waiting room |
| `socket admin:spectate` | ✅ | admin-games.spec.ts › spectate a running match and come back |
| `socket admin:unspectate` | ✅ | admin-games.spec.ts › spectate a running match and come back |
| `socket sim:cancel` | ✅ | admin-ai.spec.ts › simulations: a real-time batch opens its spectator view, leave, watch again, cancel |
| `socket sim:spectate` | ✅ | admin-ai.spec.ts › simulations: a real-time batch opens its spectator view, leave, watch again, cancel |
| `socket sim:start` | ✅ | admin-ai.spec.ts › simulations: run a fast batch, read the results, watch a replay, delete it |

## Level editor (`LevelEditorScene`: tools and actions, campaign Theme Hazards)

| Item | | Test (`spec › title`) or reason |
|---|---|---|
| `actions.back` | ✅ | editor.spec.ts › create a map: tools, the spawn rule, settings, save; admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete |
| `actions.export` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete |
| `actions.save` | ✅ | editor.spec.ts › create a map: tools, the spawn rule, settings, save; admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete |
| `modals.cancel` | ✅ | editor.spec.ts › leaving with unsaved changes: cancel, discard, save and exit |
| `modals.discard` | ✅ | editor.spec.ts › leaving with unsaved changes: cancel, discard, save and exit |
| `modals.saveAndExit` | ✅ | editor.spec.ts › leaving with unsaved changes: cancel, discard, save and exit |
| `toggle hazard-show-all` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete (classic world: no own hazards, "Show all themes" lists all seven) |
| `tool conveyor_down` | ✅ | editor.spec.ts › create a map: tools, the spawn rule, settings, save |
| `tool conveyor_left` | ✅ | editor.spec.ts › create a map: tools, the spawn rule, settings, save |
| `tool conveyor_right` | ✅ | editor.spec.ts › create a map: tools, the spawn rule, settings, save |
| `tool conveyor_up` | ✅ | editor.spec.ts › create a map: tools, the spawn rule, settings, save |
| `tool crumbling` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete |
| `tool dark_rift` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete (Theme Hazards, via "Show all themes") |
| `tool destructible` | ✅ | editor.spec.ts › create a map: tools, the spawn rule, settings, save |
| `tool empty` | ✅ | editor.spec.ts › create a map: tools, the spawn rule, settings, save |
| `tool enemy` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete |
| `tool eraser` | ✅ | editor.spec.ts › undo, redo, eraser and resize |
| `tool exit` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete |
| `tool goal` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete |
| `tool ice` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete (Theme Hazards, via "Show all themes") |
| `tool lava` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete (Theme Hazards, via "Show all themes") |
| `tool mud` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete (Theme Hazards, via "Show all themes") |
| `tool powerup` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete |
| `tool puzzle_gate` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete |
| `tool puzzle_switch` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete |
| `tool quicksand` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete (Theme Hazards, via "Show all themes") |
| `tool spawn` | ✅ | editor.spec.ts › create a map: tools, the spawn rule, settings, save |
| `tool spikes` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete (Theme Hazards, via "Show all themes") |
| `tool teleporter_a` | ✅ | editor.spec.ts › create a map: tools, the spawn rule, settings, save |
| `tool teleporter_b` | ✅ | editor.spec.ts › create a map: tools, the spawn rule, settings, save |
| `tool vine` | ✅ | admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete (Theme Hazards, via "Show all themes") |
| `tool wall` | ✅ | editor.spec.ts › leaving with unsaved changes: cancel, discard, save and exit |

## Account flows (`/auth/*`, `/user/*` account routes)

| Item | | Test (`spec › title`) or reason |
|---|---|---|
| `delete /user/account` | ✅ | account.spec.ts › settings: account › delete the account |
| `delete /user/email` | ✅ | account.spec.ts › settings: account › change email: confirmation mail, pending change, cancel and confirm |
| `get /auth/verify-email/:token` | ✅ | account.spec.ts › register and verify › register, get stuck at verification, verify by mail, play |
| `get /user/confirm-email/:token` | ✅ | account.spec.ts › settings: account › change email: confirmation mail, pending change, cancel and confirm |
| `get /user/profile` | ✅ | account.spec.ts › settings: account › rename |
| `post /auth/forgot-password` | ✅ | account.spec.ts › password reset › forgot password, new password from the mail link, sign in with it; account.spec.ts › password reset › an unknown address gets the same answer and no mail |
| `post /auth/login` | ✅ | account.spec.ts › register and verify › register, get stuck at verification, verify by mail, play; account.spec.ts › two-factor authentication › enable, sign in with a code and with a backup code, then disable |
| `post /auth/logout` | ✅ | account.spec.ts › register and verify › resend the verification mail, then go back to login |
| `post /auth/refresh` | ✅ | account.spec.ts › register and verify › register, get stuck at verification, verify by mail, play (the verify link signs in through the refresh cookie) |
| `post /auth/register` | ✅ | account.spec.ts › register and verify › the form checks its fields before and on the server; account.spec.ts › register and verify › registering a taken email looks the same and warns the owner; account.spec.ts › register and verify › three registrations racing for one name: one wins, the others hear it is taken |
| `post /auth/resend-verification` | ✅ | account.spec.ts › register and verify › resend the verification mail, then go back to login |
| `post /auth/reset-password` | ✅ | account.spec.ts › password reset › forgot password, new password from the mail link, sign in with it; account.spec.ts › password reset › a used reset link offers a new one |
| `post /auth/verify-totp` | ✅ | account.spec.ts › two-factor authentication › enable, sign in with a code and with a backup code, then disable |
| `post /user/email` | ✅ | account.spec.ts › settings: account › change email: confirmation mail, pending change, cancel and confirm; account.spec.ts › settings: account › an admin changes the email directly |
| `post /user/password` | ✅ | account.spec.ts › settings: account › change password |
| `post /user/totp/confirm` | ✅ | account.spec.ts › two-factor authentication › enable, sign in with a code and with a backup code, then disable |
| `post /user/totp/disable` | ✅ | account.spec.ts › two-factor authentication › enable, sign in with a code and with a backup code, then disable |
| `post /user/totp/setup` | ✅ | account.spec.ts › two-factor authentication › enable, sign in with a code and with a backup code, then disable |
| `put /user/language` | ✅ | i18n.spec.ts › the language picked in the settings belongs to the account |
| `put /user/profile` | ✅ | account.spec.ts › settings: account › rename |

## Languages (12)

| Item | | Test (`spec › title`) or reason |
|---|---|---|
| `en` | ✅ | i18n.spec.ts › the sign-in form switches through all 12 languages and remembers the choice; i18n.spec.ts › lobby and admin labels in English |
| `de` | ✅ | i18n.spec.ts › the sign-in form switches through all 12 languages and remembers the choice; i18n.spec.ts › lobby and admin labels in Deutsch |
| `fr` | ✅ | i18n.spec.ts › the sign-in form switches through all 12 languages and remembers the choice; i18n.spec.ts › lobby and admin labels in Français |
| `es` | ✅ | i18n.spec.ts › the sign-in form switches through all 12 languages and remembers the choice; i18n.spec.ts › lobby and admin labels in Español |
| `it` | ✅ | i18n.spec.ts › the sign-in form switches through all 12 languages and remembers the choice; i18n.spec.ts › lobby and admin labels in Italiano |
| `pt` | ✅ | i18n.spec.ts › the sign-in form switches through all 12 languages and remembers the choice; i18n.spec.ts › lobby and admin labels in Português |
| `pl` | ✅ | i18n.spec.ts › the sign-in form switches through all 12 languages and remembers the choice; i18n.spec.ts › lobby and admin labels in Polski |
| `nl` | ✅ | i18n.spec.ts › the sign-in form switches through all 12 languages and remembers the choice; i18n.spec.ts › lobby and admin labels in Nederlands |
| `tr` | ✅ | i18n.spec.ts › the sign-in form switches through all 12 languages and remembers the choice; i18n.spec.ts › lobby and admin labels in Türkçe |
| `sv` | ✅ | i18n.spec.ts › the sign-in form switches through all 12 languages and remembers the choice; i18n.spec.ts › lobby and admin labels in Svenska |
| `nb` | ✅ | i18n.spec.ts › the sign-in form switches through all 12 languages and remembers the choice; i18n.spec.ts › lobby and admin labels in Norsk |
| `da` | ✅ | i18n.spec.ts › the sign-in form switches through all 12 languages and remembers the choice; i18n.spec.ts › lobby and admin labels in Dansk |

## Themes (11)

| Item | | Test (`spec › title`) or reason |
|---|---|---|
| `inferno` | ✅ | themes.spec.ts › every theme can be picked in the settings and survives a reload |
| `arctic` | ✅ | themes.spec.ts › every theme can be picked in the settings and survives a reload |
| `toxic` | ✅ | themes.spec.ts › every theme can be picked in the settings and survives a reload |
| `crimson` | ✅ | themes.spec.ts › every theme can be picked in the settings and survives a reload |
| `midnight` | ✅ | themes.spec.ts › every theme can be picked in the settings and survives a reload |
| `daylight` | ✅ | themes.spec.ts › every theme can be picked in the settings and survives a reload |
| `sakura` | ✅ | themes.spec.ts › every theme can be picked in the settings and survives a reload |
| `sand` | ✅ | themes.spec.ts › every theme can be picked in the settings and survives a reload |
| `frost` | ✅ | themes.spec.ts › every theme can be picked in the settings and survives a reload |
| `blossom` | ✅ | themes.spec.ts › every theme can be picked in the settings and survives a reload |
| `dune` | ✅ | themes.spec.ts › every theme can be picked in the settings and survives a reload |

## Cross-cutting flows and roles

| Flow | | Test |
|---|---|---|
| Admin panel as admin (12 tabs, each renders, no page error / 5xx) | ✅ | admin-sweep.spec.ts › an admin opens all 12 tabs |
| Admin panel as moderator (Users, Matches, Rooms read-only; admin-only API 403) | ✅ | admin-sweep.spec.ts › a moderator gets the staff tabs and nothing admin-only |
| Admin panel as player (no Admin entry; API 403) and guest (API 401) | ✅ | admin-sweep.spec.ts › a player has no Admin entry and the API refuses |
| Register: empty fields, short password, bad username, taken username (409) | ✅ | account.spec.ts › register and verify › the form checks its fields before and on the server |
| Register → unverified login → verification screen → "not yet" → mail link → signed in; link single-use (400) | ✅ | account.spec.ts › register and verify › register, get stuck at verification, verify by mail, play |
| Verification screen: resend (empty address, countdown, second mail), back to login (logout) | ✅ | account.spec.ts › register and verify › resend the verification mail, then go back to login |
| Register with a taken email: same answer, warning mail to the owner | ✅ | account.spec.ts › register and verify › registering a taken email looks the same and warns the owner |
| Registration closed: no Register on landing, guest HUD bar or login form; API 403 | ✅ | account.spec.ts › register and verify › with registration off there is no way to register |
| Reset: mail link, validation, mismatch, new password works, old fails | ✅ | account.spec.ts › password reset › forgot password, new password from the mail link, sign in with it |
| Reset link used twice: refused, offers a new link | ✅ | account.spec.ts › password reset › a used reset link offers a new one |
| Registration race for one name: one 200, the rest 409 (no 500) | ✅ | account.spec.ts › register and verify › three registrations racing for one name: one wins, the others hear it is taken |
| Reset for an unknown address: same answer, no mail | ✅ | account.spec.ts › password reset › an unknown address gets the same answer and no mail |
| 2FA: setup (QR, secret, 10 backup codes), wrong code, sign-in with code, backup code once, disable (wrong password refused) | ✅ | account.spec.ts › two-factor authentication › enable, sign in with a code and with a backup code, then disable |
| 2FA reset by an admin | ✅ | account.spec.ts › two-factor authentication › an admin resets a user's 2FA; admin-users.spec.ts › reset 2FA from the users table |
| Settings › Account: rename (empty, unchanged, success), password (all checks), email change (pending, cancel, stale link 400, confirm), admin direct email, delete account | ✅ | account.spec.ts › settings: account › rename; account.spec.ts › settings: account › change password; account.spec.ts › settings: account › change email: confirmation mail, pending change, cancel and confirm; account.spec.ts › settings: account › an admin changes the email directly; account.spec.ts › settings: account › delete the account |
| Language: sign-in picker through all 12, stored per browser | ✅ | i18n.spec.ts › the sign-in form switches through all 12 languages and remembers the choice |
| Language: browser locale (de-AT starts in German) | ✅ | i18n.spec.ts › a browser set to German starts in German |
| Language: settings select stored on the account, applied on another browser, mail in that language | ✅ | i18n.spec.ts › the language picked in the settings belongs to the account |
| Language: account status messages in the interface language | ✅ | i18n.spec.ts › account messages come in the interface language |
| Language: lobby sidebar + 12 admin tab labels in each language, no raw i18n keys | ✅ | i18n.spec.ts › lobby and admin labels in English; i18n.spec.ts › lobby and admin labels in Deutsch; i18n.spec.ts › lobby and admin labels in Français; i18n.spec.ts › lobby and admin labels in Español; i18n.spec.ts › lobby and admin labels in Italiano; i18n.spec.ts › lobby and admin labels in Português; i18n.spec.ts › lobby and admin labels in Polski; i18n.spec.ts › lobby and admin labels in Nederlands; i18n.spec.ts › lobby and admin labels in Türkçe; i18n.spec.ts › lobby and admin labels in Svenska; i18n.spec.ts › lobby and admin labels in Norsk; i18n.spec.ts › lobby and admin labels in Dansk |
| Theme: each of the 11 picks applies its palette, persists across reloads | ✅ | themes.spec.ts › every theme can be picked in the settings and survives a reload |
| Theme: admin default for browsers without a choice; own pick wins | ✅ | themes.spec.ts › the admin default theme applies to browsers without a choice |
| Level editor entry points: My Maps › Create / Edit; Campaign › Add Level / Edit; Back returns to where it came from | ✅ | editor.spec.ts › create a map: tools, the spawn rule, settings, save; admin-campaign.spec.ts › levels: build one in the editor, export, import, publish, delete |
| Level editor: spawn rule (needs 2), odd-size resize, undo/redo, unsaved-changes dialog | ✅ | editor.spec.ts › create a map: tools, the spawn rule, settings, save; editor.spec.ts › undo, redo, eraser and resize; editor.spec.ts › leaving with unsaved changes: cancel, discard, save and exit |
