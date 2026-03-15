import { getSettings, saveSettings, VisualSettings } from '../../game/Settings';
import { UIGamepadNavigator } from '../../game/UIGamepadNavigator';

export function showSettingsModal(): void {
  const settings = getSettings();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="width:300px;">
      <h2>Visual Settings</h2>
      <label class="settings-option">
        <input type="checkbox" name="animations" ${settings.animations ? 'checked' : ''}>
        <span>Animations</span>
      </label>
      <label class="settings-option">
        <input type="checkbox" name="screenShake" ${settings.screenShake ? 'checked' : ''}>
        <span>Screen Shake</span>
      </label>
      <label class="settings-option">
        <input type="checkbox" name="particles" ${settings.particles ? 'checked' : ''}>
        <span>Particles</span>
      </label>
      <div class="modal-actions">
        <button class="btn btn-primary" id="modal-close">Close</button>
      </div>
    </div>
  `;

  modal.addEventListener('change', (e: Event) => {
    const target = e.target as HTMLInputElement;
    if (!target || target.type !== 'checkbox') return;
    const key = target.name as keyof VisualSettings;
    const current = getSettings();
    (current as any)[key] = target.checked;
    saveSettings(current);
  });

  const closeModal = () => {
    UIGamepadNavigator.getInstance().popContext('settings-modal');
    modal.remove();
  };

  modal.querySelector('#modal-close')!.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.getElementById('ui-overlay')!.appendChild(modal);

  UIGamepadNavigator.getInstance().pushContext({
    id: 'settings-modal',
    elements: () => [...modal.querySelectorAll<HTMLElement>('.settings-option, #modal-close')],
    onBack: closeModal,
  });
}
