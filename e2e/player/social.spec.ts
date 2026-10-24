import type { Page } from '@playwright/test';

import {
  test,
  expect,
  befriend,
  createRoom,
  createUser,
  newPage,
  openLobby,
  openView,
  uniq,
  type User,
} from './lib';

/* Friends, direct messages, parties, lobby chat and room invites - always two (or three) players
 * in their own browser contexts, so every update arrives over the real sockets. */

const card = (p: Page, name: string) => p.locator('.friend-card', { hasText: name });

async function friendsTab(p: Page, tab: 'friends' | 'requests' | 'blocked') {
  await p.locator(`.tab-item[data-tab="${tab}"]`).click();
  await expect(p.locator(`.tab-item[data-tab="${tab}"]`)).toHaveClass(/active/);
}

async function sendRequest(p: Page, to: User) {
  await p.getByRole('textbox', { name: 'Search by username...' }).fill(to.username);
  await p.getByRole('button', { name: 'Add Friend' }).click();
  await p
    .locator('.friend-card', { hasText: to.username })
    .getByRole('button', { name: 'Add Friend' })
    .click();
  await expect(p.getByText(`Friend request sent to ${to.username}`)).toBeVisible();
}

test('friend requests: send, decline, cancel, accept, remove, block, unblock', async ({
  page,
  browser,
  guard,
}) => {
  test.setTimeout(180_000);
  const [a, b, c] = [await createUser('fa'), await createUser('fb'), await createUser('fc')];
  const pageB = await newPage(browser, guard);
  await openLobby(page, a);
  await openLobby(pageB, b);
  await openView(page, 'friends');
  await openView(pageB, 'friends');
  await expect(page.getByText('No friends yet — add someone!')).toBeVisible();

  // Request arrives live, with a toast and a badge; declining clears it.
  await sendRequest(page, b);
  await expect(pageB.getByText(`${a.username} sent you a friend request`)).toBeVisible();
  await expect(pageB.locator('.tab-item[data-tab="requests"] .badge')).toHaveText('1');
  await friendsTab(pageB, 'requests');
  await card(pageB, a.username).getByRole('button', { name: 'Decline' }).click();
  await expect(card(pageB, a.username)).toHaveCount(0);

  // An outgoing request can be withdrawn.
  await sendRequest(page, c);
  await friendsTab(page, 'requests');
  await card(page, c.username).getByRole('button', { name: 'Cancel' }).click();
  await expect(card(page, c.username)).toHaveCount(0);

  // Ask again; this time accept. Both lists show the other as online.
  await friendsTab(page, 'friends');
  await sendRequest(page, b);
  await card(pageB, a.username).getByRole('button', { name: 'Accept' }).click();
  await expect(pageB.getByText('Friend request accepted')).toBeVisible();
  await friendsTab(pageB, 'friends');
  await expect(card(pageB, a.username)).toBeVisible();
  await expect(card(page, b.username)).toContainText(/Online|In Lobby|Lobby/i);

  // Remove: gone on both sides.
  await card(page, b.username).getByRole('button', { name: 'Remove' }).click();
  await expect(card(page, b.username)).toHaveCount(0);
  await expect(card(pageB, a.username)).toHaveCount(0);

  // Block (with a confirmation) and unblock.
  await befriend(a, c);
  await page.reload();
  await expect(page.locator('.hud-ow-board')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#leave-confirm').click();
  await openView(page, 'friends');
  await card(page, c.username).getByRole('button', { name: 'Block' }).click();
  const dialog = page.getByRole('dialog', { name: 'Block user' });
  await expect(dialog).toContainText(c.username);
  await dialog.locator('#friend-block-confirm').click();
  await expect(card(page, c.username)).toHaveCount(0);
  await friendsTab(page, 'blocked');
  await expect(card(page, c.username)).toBeVisible();
  await card(page, c.username).getByRole('button', { name: 'Unblock' }).click();
  await expect(page.getByText('No blocked users')).toBeVisible();
  await pageB.context().close();
});

test('direct messages arrive live, with unread badge and read receipt', async ({
  page,
  browser,
  guard,
}) => {
  const [a, b] = [await createUser('dma'), await createUser('dmb')];
  await befriend(a, b);
  const pageB = await newPage(browser, guard);
  await openLobby(page, a);
  await openLobby(pageB, b);
  await openView(pageB, 'messages');
  await expect(pageB.getByText('No conversations yet')).toBeVisible();

  // From the friend card's Msg button straight into the conversation.
  await openView(page, 'friends');
  await card(page, b.username).getByRole('button', { name: 'Msg' }).click();
  await expect(page.locator('.messages-conv-name')).toHaveText(b.username);
  const text = uniq('hello ');
  await page.getByRole('textbox', { name: 'Direct message' }).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.messages-msg-bubble', { hasText: text })).toBeVisible();

  const conv = pageB.locator('.messages-conv-item', { hasText: a.username });
  await expect(conv).toContainText(text);
  await expect(conv.locator('.messages-unread-badge')).toHaveText('1');
  await conv.click();
  await expect(pageB.locator('.messages-msg-bubble', { hasText: text })).toBeVisible();
  await expect(conv.locator('.messages-unread-badge')).toHaveCount(0);
  // The sender sees it read.
  await expect(page.locator('.messages-read-indicator').last()).toBeVisible();

  // And the reply comes back the other way.
  await pageB.getByRole('textbox', { name: 'Direct message' }).fill('hi back');
  await pageB.getByRole('textbox', { name: 'Direct message' }).press('Enter');
  await expect(page.locator('.messages-msg-bubble', { hasText: 'hi back' })).toBeVisible();
  await pageB.context().close();
});

test('party: create, invite, accept, chat, follow into a room, kick, disband', async ({
  page,
  browser,
  guard,
}) => {
  test.setTimeout(180_000);
  const [lead, mate] = [await createUser('pl'), await createUser('pm')];
  await befriend(lead, mate);
  const pageB = await newPage(browser, guard);
  await openLobby(page, lead);
  await openLobby(pageB, mate);

  await openView(page, 'party');
  await page.getByRole('button', { name: 'Create Party' }).click();
  await expect(page.locator('.party-member-card')).toHaveCount(1);
  const invite = pageB.locator('.invite-toast');
  const inviteMate = async () => {
    await page.getByRole('button', { name: '+ Invite Friend' }).click();
    await page
      .locator('.party-invite-item', { hasText: mate.username })
      .getByRole('button', { name: 'Invite Friend' })
      .click();
    await expect(invite).toContainText(`${lead.username} invited you to their party`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };

  // Declined: nobody joins.
  await inviteMate();
  await invite.getByRole('button', { name: 'Decline' }).click();
  await expect(invite).toHaveCount(0);
  await expect(page.locator('.party-member-card')).toHaveCount(1);

  await inviteMate();
  await invite.getByRole('button', { name: 'Accept' }).click();
  await expect(pageB.getByText('Joined party')).toBeVisible();
  await expect(page.locator('.party-member-card')).toHaveCount(2);
  await openView(pageB, 'party');
  await expect(pageB.locator('.party-member-card')).toHaveCount(2);
  await expect(pageB.getByRole('button', { name: 'Leave Party' })).toBeVisible();

  // Party chat reaches the other member.
  const msg = uniq('gl hf ');
  await page.getByRole('textbox', { name: 'Party chat message' }).fill(msg);
  await page.getByRole('textbox', { name: 'Party chat message' }).press('Enter');
  await expect(pageB.getByText(msg)).toBeVisible();

  // The leader enters a room; the member follows.
  const room = uniq('Party ');
  await createRoom(page, { name: room });
  await expect(pageB.getByRole('heading', { name: room })).toBeVisible();
  await expect(page.locator('#room-player-list')).toContainText(mate.username);
  await page.getByRole('button', { name: '← Back' }).click();
  await pageB.getByRole('button', { name: '← Back' }).click();

  // The member leaves on their own; invited back, then kicked; then the party is disbanded.
  await openView(page, 'party');
  await openView(pageB, 'party');
  await pageB.getByRole('button', { name: 'Leave Party' }).click();
  await expect(page.locator('.party-member-card')).toHaveCount(1);
  await inviteMate();
  await invite.getByRole('button', { name: 'Accept' }).click();
  await expect(page.locator('.party-member-card')).toHaveCount(2);
  await page
    .locator('.party-member-card', { hasText: mate.username })
    .getByRole('button', { name: 'Kick' })
    .click();
  await expect(page.locator('.party-member-card')).toHaveCount(1);
  await openView(pageB, 'party');
  await expect(pageB.getByRole('heading', { name: 'No Active Party' })).toBeVisible();
  await page.getByRole('button', { name: 'Disband' }).click();
  await expect(page.getByRole('heading', { name: 'No Active Party' })).toBeVisible();
  await pageB.context().close();
});

test('room invite from a friend; joining a friend from the friends list', async ({
  page,
  browser,
  guard,
}) => {
  const [host, f1, f2] = [await createUser('ih'), await createUser('if'), await createUser('ij')];
  await befriend(host, f1);
  await befriend(host, f2);
  const pageB = await newPage(browser, guard);
  const pageC = await newPage(browser, guard);
  await openLobby(page, host);
  await openLobby(pageB, f1);
  await openLobby(pageC, f2);

  const room = uniq('Invite ');
  await createRoom(page, { name: room });
  await page.getByRole('button', { name: 'Invite Friend' }).click();
  const picker = page.getByRole('dialog', { name: 'Invite Friend' });
  for (const f of [f1, f2]) {
    await picker
      .locator('.party-invite-item', { hasText: f.username })
      .getByRole('button', { name: 'Invite' })
      .click();
  }
  await expect(picker.getByRole('button', { name: 'Sent' })).toHaveCount(2);
  await page.keyboard.press('Escape');

  // f2 declines; f1 accepts and is put into the room.
  const declined = pageC.locator('.invite-toast');
  await expect(declined).toContainText(`${host.username} invited you to a room`);
  await declined.getByRole('button', { name: 'Decline' }).click();
  await expect(declined).toHaveCount(0);
  const invite = pageB.locator('.invite-toast');
  await expect(invite).toContainText(`${host.username} invited you to a room`);
  await invite.getByRole('button', { name: 'Accept' }).click();
  await expect(pageB.getByRole('heading', { name: room })).toBeVisible();

  // f2 sees the host sitting in a waiting room and joins from the friend card.
  await openView(pageC, 'friends');
  await card(pageC, host.username).getByRole('button', { name: 'Join' }).click();
  await expect(pageC.getByRole('heading', { name: room })).toBeVisible();
  await expect(page.locator('#room-player-list')).toContainText(f2.username);
  await pageB.context().close();
  await pageC.context().close();
});

test('lobby chat reaches everyone in the lobby', async ({ page, browser, guard }) => {
  const [a, b] = [await createUser('lca'), await createUser('lcb')];
  const pageB = await newPage(browser, guard);
  await openLobby(page, a);
  await openLobby(pageB, b);
  for (const p of [page, pageB]) await p.locator('.lobby-chat-toggle').click();
  const msg = uniq('anyone up ');
  await page.getByRole('textbox', { name: /lobby chat/i }).fill(msg);
  await page.getByRole('textbox', { name: /lobby chat/i }).press('Enter');
  await expect(pageB.locator('.lobby-chat-msg', { hasText: msg })).toContainText(a.username);
  await pageB.context().close();
});
