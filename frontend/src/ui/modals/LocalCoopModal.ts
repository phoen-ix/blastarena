import {
  ControlPreset,
  CameraMode,
  LocalCoopConfig,
  CONTROL_PRESET_LABELS,
  CAMERA_MODE_LABELS,
  loadLocalCoopConfig,
  saveLocalCoopConfig,
} from '../../game/LocalCoopInput';
import { UIGamepadNavigator } from '../../game/UIGamepadNavigator';

const ALL_PRESETS: ControlPreset[] = ['wasd', 'arrows', 'numpad', 'gamepad1', 'gamepad2'];

export function showLocalCoopModal(
  onStart: (config: LocalCoopConfig) => void,
  onCancel: () => void,
): void {
  const config = loadLocalCoopConfig();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  function closeModal(): void {
    UIGamepadNavigator.getInstance().popContext('local-coop-modal');
    overlay.remove();
  }

  function hasConflict(): boolean {
    return config.p1Controls === config.p2Controls;
  }

  function render(): void {
    overlay.innerHTML = '';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.cssText = 'width:520px;max-width:95vw;';

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

    body.appendChild(
      createPlayerSection(
        'Player 1 Controls',
        config.p1Controls,
        (preset) => {
          config.p1Controls = preset;
          render();
        },
        config.p2Controls,
      ),
    );

    body.appendChild(
      createPlayerSection(
        'Player 2 Controls',
        config.p2Controls,
        (preset) => {
          config.p2Controls = preset;
          render();
        },
        config.p1Controls,
      ),
    );

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
      saveLocalCoopConfig(config);
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
      ],
      onBack: () => {
        closeModal();
        onCancel();
      },
    });
  }

  // Backdrop click to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeModal();
      onCancel();
    }
  });

  render();

  const uiOverlay = document.getElementById('ui-overlay');
  if (uiOverlay) {
    uiOverlay.appendChild(overlay);
  } else {
    document.body.appendChild(overlay);
  }
}

function createPlayerSection(
  label: string,
  selected: ControlPreset,
  onSelect: (preset: ControlPreset) => void,
  otherSelected: ControlPreset,
): HTMLElement {
  const section = document.createElement('div');

  const heading = document.createElement('div');
  heading.style.cssText = `
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 8px;
    letter-spacing: 0.5px;
  `;
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

    // Dim chips that the other player is using
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

const ALL_CAMERA_MODES: CameraMode[] = ['shared', 'split-h', 'split-v'];

function createCameraModeSection(
  selected: CameraMode,
  onSelect: (mode: CameraMode) => void,
): HTMLElement {
  const section = document.createElement('div');

  const heading = document.createElement('div');
  heading.style.cssText = `
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 8px;
    letter-spacing: 0.5px;
  `;
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
