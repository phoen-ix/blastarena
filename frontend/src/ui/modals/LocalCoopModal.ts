import {
  ControlPreset,
  CameraMode,
  LocalCoopConfig,
  LocalCoopP2Identity,
  CONTROL_PRESET_LABELS,
  CAMERA_MODE_LABELS,
  loadLocalCoopConfig,
  saveLocalCoopConfig,
  loadP2Identity,
  saveP2Identity,
} from '../../game/LocalCoopInput';
import { UIGamepadNavigator } from '../../game/UIGamepadNavigator';
import { PLAYER_COLORS } from '../../scenes/BootScene';
import { AuthManager } from '../../network/AuthManager';
import { PlayerCosmeticData } from '@blast-arena/shared';

const ALL_PRESETS: ControlPreset[] = ['wasd', 'arrows', 'numpad', 'gamepad1', 'gamepad2'];
const ALL_CAMERA_MODES: CameraMode[] = ['shared', 'split-h', 'split-v'];

const DURATION_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Session only' },
  { value: 1, label: '1 hour' },
  { value: 6, label: '6 hours' },
  { value: 12, label: '12 hours' },
  { value: 24, label: '24 hours' },
];

const SECTION_HEADING_STYLE = `
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 8px;
  letter-spacing: 0.5px;
`;

interface P2State {
  mode: 'guest' | 'loggedIn';
  guestName: string;
  guestColor: number;
  loggedInUser?: { id: number; username: string };
  loggedInCosmetics?: PlayerCosmeticData;
  loginError?: string;
  loginLoading?: boolean;
  duration: number;
}

export function showLocalCoopModal(
  onStart: (config: LocalCoopConfig) => void,
  onCancel: () => void,
  authManager: AuthManager,
): void {
  const config = loadLocalCoopConfig();
  const savedP2 = loadP2Identity();

  const p2: P2State = {
    mode: 'guest',
    guestName: savedP2.guestName,
    guestColor: savedP2.guestColor,
    duration: 0,
  };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  function closeModal(): void {
    UIGamepadNavigator.getInstance().popContext('local-coop-modal');
    overlay.remove();
  }

  function hasConflict(): boolean {
    return config.p1Controls === config.p2Controls;
  }

  function buildP2Identity(): LocalCoopP2Identity {
    if (p2.mode === 'loggedIn' && p2.loggedInUser) {
      return {
        mode: 'loggedIn',
        guestName: p2.guestName,
        guestColor: p2.guestColor,
        loggedInUserId: p2.loggedInUser.id,
        loggedInUsername: p2.loggedInUser.username,
      };
    }
    return {
      mode: 'guest',
      guestName: p2.guestName || 'Player 2',
      guestColor: p2.guestColor,
    };
  }

  async function tryLogin(username: string, password: string): Promise<void> {
    p2.loginLoading = true;
    p2.loginError = undefined;
    render();

    try {
      const token = authManager.getAccessToken();
      const resp = await fetch('/api/local-coop/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ username, password, duration: p2.duration }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        p2.loginError = data.error || 'Login failed';
        p2.loginLoading = false;
        render();
        return;
      }

      p2.mode = 'loggedIn';
      p2.loggedInUser = data.user;
      p2.loggedInCosmetics = data.cosmetics;
      p2.loginError = undefined;
      p2.loginLoading = false;
      render();
    } catch {
      p2.loginError = 'Connection error';
      p2.loginLoading = false;
      render();
    }
  }

  async function doLogout(): Promise<void> {
    try {
      await fetch('/api/local-coop/logout', { method: 'POST', credentials: 'include' });
    } catch {
      /* ignore */
    }
    p2.mode = 'guest';
    p2.loggedInUser = undefined;
    p2.loggedInCosmetics = undefined;
    render();
  }

  function render(): void {
    overlay.innerHTML = '';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.cssText = 'width:560px;max-width:95vw;max-height:90vh;overflow-y:auto;';

    // Header
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.style.cssText =
      'display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;';

    const title = document.createElement('h2');
    title.style.cssText = 'margin:0;font-size:20px;';
    title.textContent = 'Local Co-Op Setup';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-ghost btn-sm';
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText = 'font-size:18px;padding:4px 8px;';
    closeBtn.addEventListener('click', () => {
      closeModal();
      onCancel();
    });

    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'modal-body';
    body.style.cssText = 'display:flex;flex-direction:column;gap:20px;';

    // Player 1 Controls
    body.appendChild(
      createControlsSection(
        'Player 1 Controls',
        config.p1Controls,
        (preset) => {
          config.p1Controls = preset;
          render();
        },
        config.p2Controls,
      ),
    );

    // Player 2 section (identity + controls)
    body.appendChild(createP2Section());

    // Camera mode
    body.appendChild(
      createCameraModeSection(config.cameraMode, (mode) => {
        config.cameraMode = mode;
        render();
      }),
    );

    // Conflict warning
    if (hasConflict()) {
      const warning = document.createElement('div');
      warning.style.cssText = `
        color: var(--warning);
        font-size: 13px;
        font-weight: 600;
        text-align: center;
        padding: 8px;
        background: rgba(255,180,0,0.1);
        border-radius: var(--radius);
        border: 1px solid rgba(255,180,0,0.3);
      `;
      warning.textContent = 'Both players cannot use the same controls';
      body.appendChild(warning);
    }

    modal.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    footer.style.cssText =
      'display:flex;justify-content:flex-end;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid var(--border);';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      closeModal();
      onCancel();
    });

    const startBtn = document.createElement('button');
    startBtn.className = 'btn btn-primary';
    startBtn.textContent = 'Start';
    startBtn.disabled = hasConflict();
    if (hasConflict()) {
      startBtn.style.opacity = '0.5';
      startBtn.style.cursor = 'not-allowed';
    }
    startBtn.addEventListener('click', () => {
      if (hasConflict()) return;
      const identity = buildP2Identity();
      config.p2Identity = identity;
      saveLocalCoopConfig(config);
      saveP2Identity(identity);
      closeModal();
      onStart({ ...config });
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(startBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);

    // Gamepad context
    UIGamepadNavigator.getInstance().pushContext({
      id: 'local-coop-modal',
      elements: () => [
        ...overlay.querySelectorAll<HTMLElement>('.option-chip'),
        ...overlay.querySelectorAll<HTMLElement>('.btn'),
        ...overlay.querySelectorAll<HTMLElement>('input,select'),
      ],
      onBack: () => {
        closeModal();
        onCancel();
      },
    });
  }

  function createP2Section(): HTMLElement {
    const section = document.createElement('div');
    section.style.cssText =
      'border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; display: flex; flex-direction: column; gap: 16px;';

    const sectionTitle = document.createElement('div');
    sectionTitle.style.cssText = SECTION_HEADING_STYLE + 'font-size: 16px; margin-bottom: 0;';
    sectionTitle.textContent = 'Player 2';
    section.appendChild(sectionTitle);

    // Mode toggle (Guest / Log In)
    const modeRow = document.createElement('div');
    modeRow.style.cssText = 'display:flex;gap:8px;align-items:center;';

    const modeLabel = document.createElement('span');
    modeLabel.style.cssText = 'font-size:13px;color:var(--text-dim);margin-right:4px;';
    modeLabel.textContent = 'Identity:';
    modeRow.appendChild(modeLabel);

    for (const mode of ['guest', 'loggedIn'] as const) {
      const chip = document.createElement('div');
      chip.className = 'option-chip';
      chip.style.cursor = 'pointer';
      if (p2.mode === mode) {
        chip.style.borderColor = 'var(--primary)';
        chip.style.background = 'rgba(var(--primary-rgb, 255,107,53), 0.15)';
        chip.style.color = 'var(--primary)';
      }
      chip.textContent = mode === 'guest' ? 'Guest' : 'Log In';
      chip.addEventListener('click', () => {
        if (p2.mode !== mode) {
          p2.mode = mode;
          p2.loginError = undefined;
          render();
        }
      });
      modeRow.appendChild(chip);
    }
    section.appendChild(modeRow);

    // Mode-specific content
    if (p2.mode === 'guest') {
      section.appendChild(createGuestIdentity());
    } else if (p2.loggedInUser) {
      section.appendChild(createLoggedInDisplay());
    } else {
      section.appendChild(createLoginForm());
    }

    // Controls (always shown)
    section.appendChild(
      createControlsSection(
        'Controls',
        config.p2Controls,
        (preset) => {
          config.p2Controls = preset;
          render();
        },
        config.p1Controls,
      ),
    );

    return section;
  }

  function createGuestIdentity(): HTMLElement {
    const container = document.createElement('div');
    container.style.cssText = 'display:flex;flex-direction:column;gap:12px;';

    // Name input
    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display:flex;align-items:center;gap:8px;';

    const nameLabel = document.createElement('span');
    nameLabel.style.cssText = 'font-size:13px;color:var(--text-dim);white-space:nowrap;';
    nameLabel.textContent = 'Name:';
    nameRow.appendChild(nameLabel);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'input';
    nameInput.style.cssText = 'flex:1;padding:6px 10px;font-size:14px;';
    nameInput.maxLength = 20;
    nameInput.value = p2.guestName;
    nameInput.placeholder = 'Player 2';
    nameInput.addEventListener('input', () => {
      p2.guestName = nameInput.value;
    });
    nameRow.appendChild(nameInput);
    container.appendChild(nameRow);

    // Color swatches
    const colorRow = document.createElement('div');
    colorRow.style.cssText = 'display:flex;align-items:center;gap:8px;';

    const colorLabel = document.createElement('span');
    colorLabel.style.cssText = 'font-size:13px;color:var(--text-dim);white-space:nowrap;';
    colorLabel.textContent = 'Color:';
    colorRow.appendChild(colorLabel);

    const swatches = document.createElement('div');
    swatches.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';

    for (const color of PLAYER_COLORS) {
      const swatch = document.createElement('div');
      const hex = `#${color.toString(16).padStart(6, '0')}`;
      const isSelected = p2.guestColor === color;
      swatch.style.cssText = `
        width: 28px; height: 28px; border-radius: 50%; cursor: pointer;
        background: ${hex};
        border: 3px solid ${isSelected ? 'var(--text)' : 'transparent'};
        box-shadow: ${isSelected ? '0 0 0 2px var(--primary)' : 'none'};
        transition: border-color 0.15s, box-shadow 0.15s;
      `;
      swatch.addEventListener('click', () => {
        p2.guestColor = color;
        render();
      });
      swatches.appendChild(swatch);
    }

    colorRow.appendChild(swatches);
    container.appendChild(colorRow);

    return container;
  }

  function createLoginForm(): HTMLElement {
    const container = document.createElement('div');
    container.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    // Username
    const usernameInput = document.createElement('input');
    usernameInput.type = 'text';
    usernameInput.className = 'input';
    usernameInput.placeholder = 'Username';
    usernameInput.style.cssText = 'padding:6px 10px;font-size:14px;';
    usernameInput.autocomplete = 'off';
    container.appendChild(usernameInput);

    // Password
    const passwordInput = document.createElement('input');
    passwordInput.type = 'password';
    passwordInput.className = 'input';
    passwordInput.placeholder = 'Password';
    passwordInput.style.cssText = 'padding:6px 10px;font-size:14px;';
    passwordInput.autocomplete = 'off';
    container.appendChild(passwordInput);

    // Duration + Login button row
    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display:flex;gap:8px;align-items:center;';

    const durationSelect = document.createElement('select');
    durationSelect.className = 'select';
    durationSelect.style.cssText = 'padding:6px 8px;font-size:13px;flex:1;';
    for (const opt of DURATION_OPTIONS) {
      const option = document.createElement('option');
      option.value = String(opt.value);
      option.textContent = opt.label;
      if (opt.value === p2.duration) option.selected = true;
      durationSelect.appendChild(option);
    }
    durationSelect.addEventListener('change', () => {
      p2.duration = Number(durationSelect.value);
    });

    const loginBtn = document.createElement('button');
    loginBtn.className = 'btn btn-primary btn-sm';
    loginBtn.textContent = p2.loginLoading ? 'Logging in...' : 'Log In';
    loginBtn.disabled = !!p2.loginLoading;
    loginBtn.addEventListener('click', () => {
      const username = usernameInput.value.trim();
      const password = passwordInput.value;
      if (!username || !password) {
        p2.loginError = 'Enter username and password';
        render();
        return;
      }
      tryLogin(username, password);
    });

    // Allow Enter key to submit
    passwordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loginBtn.click();
    });

    actionRow.appendChild(durationSelect);
    actionRow.appendChild(loginBtn);
    container.appendChild(actionRow);

    // Error message
    if (p2.loginError) {
      const error = document.createElement('div');
      error.style.cssText = 'color:var(--danger);font-size:13px;';
      error.textContent = p2.loginError;
      container.appendChild(error);
    }

    return container;
  }

  function createLoggedInDisplay(): HTMLElement {
    const container = document.createElement('div');
    container.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--surface-2);border-radius:var(--radius);';

    const info = document.createElement('span');
    info.style.cssText = 'font-size:14px;color:var(--text);';
    info.innerHTML = `Logged in as <strong>${escapeHtml(p2.loggedInUser!.username)}</strong>`;

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn btn-ghost btn-sm';
    logoutBtn.textContent = 'Logout';
    logoutBtn.style.cssText = 'color:var(--danger);';
    logoutBtn.addEventListener('click', () => doLogout());

    container.appendChild(info);
    container.appendChild(logoutBtn);
    return container;
  }

  // Backdrop click to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeModal();
      onCancel();
    }
  });

  // Check for existing P2 session cookie on modal open
  fetch('/api/local-coop/session', { credentials: 'include' })
    .then((resp) => (resp.ok ? resp.json() : null))
    .then((data) => {
      if (data?.user) {
        p2.mode = 'loggedIn';
        p2.loggedInUser = data.user;
        p2.loggedInCosmetics = data.cosmetics;
        render();
      }
    })
    .catch(() => {
      /* ignore — stay in guest mode */
    });

  render();

  const uiOverlay = document.getElementById('ui-overlay');
  if (uiOverlay) {
    uiOverlay.appendChild(overlay);
  } else {
    document.body.appendChild(overlay);
  }
}

export function createControlsSection(
  label: string,
  selected: ControlPreset,
  onSelect: (preset: ControlPreset) => void,
  otherSelected: ControlPreset,
): HTMLElement {
  const section = document.createElement('div');

  const heading = document.createElement('div');
  heading.style.cssText = SECTION_HEADING_STYLE;
  heading.textContent = label;
  section.appendChild(heading);

  const chips = document.createElement('div');
  chips.className = 'option-chips';

  for (const preset of ALL_PRESETS) {
    const chip = document.createElement('div');
    chip.className = 'option-chip';
    chip.style.cursor = 'pointer';

    if (preset === selected) {
      chip.style.borderColor = 'var(--primary)';
      chip.style.background = 'rgba(var(--primary-rgb, 255,107,53), 0.15)';
      chip.style.color = 'var(--primary)';
    }

    if (preset === otherSelected && preset !== selected) {
      chip.style.opacity = '0.4';
    }

    const chipLabel = document.createElement('span');
    chipLabel.textContent = CONTROL_PRESET_LABELS[preset];
    chip.appendChild(chipLabel);

    chip.addEventListener('click', () => onSelect(preset));
    chips.appendChild(chip);
  }

  section.appendChild(chips);
  return section;
}

export function createCameraModeSection(
  selected: CameraMode,
  onSelect: (mode: CameraMode) => void,
): HTMLElement {
  const section = document.createElement('div');

  const heading = document.createElement('div');
  heading.style.cssText = SECTION_HEADING_STYLE;
  heading.textContent = 'Camera Mode';
  section.appendChild(heading);

  const chips = document.createElement('div');
  chips.className = 'option-chips';

  for (const mode of ALL_CAMERA_MODES) {
    const chip = document.createElement('div');
    chip.className = 'option-chip';
    chip.style.cursor = 'pointer';

    if (mode === selected) {
      chip.style.borderColor = 'var(--primary)';
      chip.style.background = 'rgba(var(--primary-rgb, 255,107,53), 0.15)';
      chip.style.color = 'var(--primary)';
    }

    const chipLabel = document.createElement('span');
    chipLabel.textContent = CAMERA_MODE_LABELS[mode];
    chip.appendChild(chipLabel);

    chip.addEventListener('click', () => onSelect(mode));
    chips.appendChild(chip);
  }

  section.appendChild(chips);
  return section;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
