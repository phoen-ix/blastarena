import { getSettings, saveSettings, VisualSettings } from '../../game/Settings';
import { UIGamepadNavigator } from '../../game/UIGamepadNavigator';
import { trapFocus } from '../../utils/html';
import { t } from '../../i18n';

export function showSettingsModal(): void {
  const settings = getSettings();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', t('ui:settings.visualSettings'));
  modal.innerHTML = `
    <div class="modal" style="width:300px;">
      <h2>${t('ui:settings.visualSettings')}</h2>
      <label class="settings-option">
        <input type="checkbox" name="animations" ${settings.animations ? 'checked' : ''}>
        <span>${t('ui:settings.animations')}</span>
      </label>
      <label class="settings-option">
        <input type="checkbox" name="screenShake" ${settings.screenShake ? 'checked' : ''}>
        <span>${t('ui:settings.screenShake')}</span>
      </label>
      <label class="settings-option">
        <input type="checkbox" name="particles" ${settings.particles ? 'checked' : ''}>
        <span>${t('ui:settings.particles')}</span>
      </label>
      <div class="modal-actions">
        <button class="btn btn-primary" id="modal-close">${t('ui:settings.account.close')}</button>
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

  const releaseFocusTrap = trapFocus(modal);
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeModal();
  };
  const closeModal = () => {
    releaseFocusTrap();
    document.removeEventListener('keydown', escHandler);
    UIGamepadNavigator.getInstance().popContext('settings-modal');
    modal.remove();
  };

  modal.querySelector('#modal-close')!.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', escHandler);

  document.getElementById('ui-overlay')!.appendChild(modal);

  UIGamepadNavigator.getInstance().pushContext({
    id: 'settings-modal',
    elements: () => [...modal.querySelectorAll<HTMLElement>('.settings-option, #modal-close')],
    onBack: closeModal,
  });
}
