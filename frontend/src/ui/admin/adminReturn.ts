/**
 * Where the admin panel reopens after a replay, a spectated simulation or a spectated room: the
 * tab it was started from, and the view inside that tab (handed to the tab's `restore()`).
 * Travels through the Phaser registry as `returnToAdmin`, which LobbyScene reads on start.
 */
export interface AdminReturn {
  tab: string;
  view?: Record<string, unknown>;
}
