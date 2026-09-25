import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AuthManager } from '../../src/network/AuthManager';

/**
 * Local co-op Player 2 login with 2FA (item 20).
 *
 * POST /api/local-coop/login may answer { totpRequired, totpToken } instead of the user. The modal
 * then asks for the 6-digit code and POSTs /api/local-coop/verify-totp { totpToken, code,
 * duration }, which answers like a successful login. It also pushes exactly one gamepad context
 * however often it re-renders, and pops it on close (item 12).
 */

vi.mock('../../src/i18n', () => ({ t: (key: string) => key, i18n: { language: 'en' } }));

const gamepad = { pushContext: vi.fn(), popContext: vi.fn() };
vi.mock('../../src/game/UIGamepadNavigator', () => ({
  UIGamepadNavigator: { getInstance: () => gamepad },
}));
vi.mock('../../src/scenes/BootScene', () => ({ PLAYER_COLORS: [0xff0000, 0x00ff00] }));
vi.mock('../../src/game/LocalCoopInput', () => ({
  getControlPresetLabels: () => ({
    wasd: 'WASD',
    arrows: 'Arrows',
    numpad: 'Numpad',
    gamepad1: 'Pad 1',
    gamepad2: 'Pad 2',
  }),
  getCameraModeLabels: () => ({ shared: 'Shared', 'split-h': 'H', 'split-v': 'V' }),
  loadLocalCoopConfig: () => ({ p1Controls: 'wasd', p2Controls: 'arrows', cameraMode: 'shared' }),
  saveLocalCoopConfig: vi.fn(),
  loadP2Identity: () => ({ mode: 'guest', guestName: 'P2', guestColor: 0xff0000 }),
  saveP2Identity: vi.fn(),
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

const fetchMock = vi.fn();

beforeEach(() => {
  document.body.replaceChildren();
  const overlay = document.createElement('div');
  overlay.id = 'ui-overlay';
  document.body.appendChild(overlay);
  gamepad.pushContext.mockClear();
  gamepad.popContext.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const auth = { getAccessToken: () => 'p1-token' } as unknown as AuthManager;

async function openAndLogIn() {
  const { showLocalCoopModal } = await import('../../src/ui/modals/LocalCoopModal');
  const onCancel = vi.fn();
  showLocalCoopModal(vi.fn(), onCancel, auth);
  await flush();

  // Switch P2 to "Log In" and submit credentials
  const chips = [...document.querySelectorAll<HTMLElement>('.option-chip')];
  chips.find((c) => c.textContent === 'campaign:localCoopModal.logIn')!.click();
  const [user, pass] = document.querySelectorAll<HTMLInputElement>('.modal input.input');
  user.value = 'player2';
  pass.value = 'secret-password';
  [...document.querySelectorAll<HTMLButtonElement>('.modal button')]
    .find((b) => b.textContent === 'campaign:localCoopModal.logInBtn')!
    .click();
  await flush();
  return { onCancel };
}

const codeInput = () =>
  document.querySelector<HTMLInputElement>(
    'input[aria-label="campaign:localCoopModal.totpCodeAriaLabel"]',
  );
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.modal button')].find(
    (b) => b.textContent === label,
  );

describe('LocalCoopModal 2FA', () => {
  it('asks for the code after a 2FA challenge and completes the login with it', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/local-coop/session') return json(401, { error: 'No session' });
      if (url === '/api/local-coop/login')
        return json(200, { totpRequired: true, totpToken: 'tt-1' });
      if (url === '/api/local-coop/verify-totp') {
        return json(200, { user: { id: 9, username: 'player2' }, cosmetics: {} });
      }
      throw new Error(url);
    });
    await openAndLogIn();

    expect(codeInput()).not.toBeNull();
    codeInput()!.value = '123456';
    button('campaign:localCoopModal.totpVerify')!.click();
    await flush();

    const verify = fetchMock.mock.calls.find((c) => c[0] === '/api/local-coop/verify-totp')!;
    expect(JSON.parse(verify[1].body)).toEqual({ totpToken: 'tt-1', code: '123456', duration: 0 });
    expect(verify[1].headers.Authorization).toBe('Bearer p1-token');
    expect(codeInput()).toBeNull();
    expect(document.querySelector('.modal')!.textContent).toContain(
      'campaign:localCoopModal.loggedInAs',
    );
  });

  it('shows a wrong code, and returns to the password step when the challenge expired', async () => {
    let attempt = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/local-coop/session') return json(401, {});
      if (url === '/api/local-coop/login')
        return json(200, { totpRequired: true, totpToken: 'tt' });
      attempt++;
      return attempt === 1
        ? json(401, { error: 'Invalid verification code', code: 'INVALID_TOTP_CODE' })
        : json(401, { error: 'Invalid token', code: 'INVALID_TOKEN' });
    });
    await openAndLogIn();

    codeInput()!.value = '000000';
    button('campaign:localCoopModal.totpVerify')!.click();
    await flush();
    expect(codeInput()).not.toBeNull();
    expect(document.querySelector('.modal')!.textContent).toContain(
      'campaign:localCoopModal.totpInvalidCode',
    );

    codeInput()!.value = '111111';
    button('campaign:localCoopModal.totpVerify')!.click();
    await flush();
    expect(codeInput()).toBeNull();
    expect(button('campaign:localCoopModal.logInBtn')).toBeDefined();
    expect(document.querySelector('.modal')!.textContent).toContain(
      'campaign:localCoopModal.totpExpired',
    );
  });

  it('rejects a code that is not 6 digits without a request', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/local-coop/login'
        ? json(200, { totpRequired: true, totpToken: 'tt' })
        : json(401, {}),
    );
    await openAndLogIn();
    codeInput()!.value = '12ab';
    button('campaign:localCoopModal.totpVerify')!.click();
    await flush();
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/local-coop/verify-totp')).toBe(false);
    expect(document.querySelector('.modal')!.textContent).toContain(
      'campaign:localCoopModal.totpEnterCode',
    );
  });

  it('pushes one gamepad context across re-renders and pops it once on close', async () => {
    fetchMock.mockImplementation(async () => json(401, {}));
    const { onCancel } = await openAndLogIn(); // several re-renders happened
    expect(
      gamepad.pushContext.mock.calls.filter((c) => c[0].id === 'local-coop-modal'),
    ).toHaveLength(1);

    button('campaign:localCoopModal.cancel')!.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(gamepad.popContext).toHaveBeenCalledTimes(1);
    expect(gamepad.popContext).toHaveBeenCalledWith('local-coop-modal');
  });
});
