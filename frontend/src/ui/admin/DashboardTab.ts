import { ApiClient } from '../../network/ApiClient';
import { NotificationUI } from '../NotificationUI';

export class DashboardTab {
  private container: HTMLElement | null = null;
  private notifications: NotificationUI;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private recordingsEnabled: boolean = true;

  constructor(notifications: NotificationUI) {
    this.notifications = notifications;
  }

  async render(parent: HTMLElement): Promise<void> {
    this.container = document.createElement('div');
    parent.appendChild(this.container);
    await this.loadStats();
    await this.loadRecordingSetting();
    this.refreshInterval = setInterval(() => this.loadStats(), 30000);
  }

  destroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.container?.remove();
    this.container = null;
  }

  private async loadRecordingSetting(): Promise<void> {
    try {
      const resp = await ApiClient.get<{ enabled: boolean }>('/admin/settings/recordings_enabled');
      this.recordingsEnabled = resp.enabled;
    } catch {
      // Default to true
    }
    this.renderSettingsCard();
  }

  private renderSettingsCard(): void {
    if (!this.container) return;

    // Remove existing settings card if any
    this.container.querySelector('#server-settings-card')?.remove();

    const card = document.createElement('div');
    card.id = 'server-settings-card';
    card.style.cssText = 'margin-top:20px;';
    card.innerHTML = `
      <h3 style="color:var(--text);font-size:15px;margin-bottom:12px;font-weight:600;">Server Settings</h3>
      <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;
        background:var(--bg-card);border:1px solid var(--border);border-radius:8px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;">
          <input type="checkbox" id="toggle-recordings" ${this.recordingsEnabled ? 'checked' : ''} style="accent-color:var(--accent);width:16px;height:16px;">
          <span style="color:var(--text);font-weight:600;">Match Recordings</span>
        </label>
        <span style="color:var(--text-dim);font-size:12px;">Enable replay recording for all new games</span>
      </div>
    `;
    this.container.appendChild(card);

    card.querySelector('#toggle-recordings')!.addEventListener('change', async (e) => {
      const enabled = (e.target as HTMLInputElement).checked;
      try {
        await ApiClient.put('/admin/settings/recordings_enabled', { enabled });
        this.recordingsEnabled = enabled;
        this.notifications.success(`Match recordings ${enabled ? 'enabled' : 'disabled'}`);
      } catch {
        // Revert checkbox on failure
        (e.target as HTMLInputElement).checked = !enabled;
        this.notifications.error('Failed to update setting');
      }
    });
  }

  private async loadStats(): Promise<void> {
    if (!this.container) return;
    try {
      const stats = await ApiClient.get<any>('/admin/stats');

      // Remove existing stats if re-rendering
      this.container.querySelector('.admin-stats')?.remove();

      const statsDiv = document.createElement('div');
      statsDiv.className = 'admin-stats';
      statsDiv.innerHTML = `
        <div class="stat-card">
          <div class="stat-value">${stats.totalUsers}</div>
          <div class="stat-label">Total Users</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.activeUsers24h}</div>
          <div class="stat-label">Active (24h)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.totalMatches}</div>
          <div class="stat-label">Total Matches</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.activeRooms}</div>
          <div class="stat-label">Active Rooms</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.activePlayers}</div>
          <div class="stat-label">Online Players</div>
        </div>
      `;

      // Insert stats at the top, before settings card
      const settingsCard = this.container.querySelector('#server-settings-card');
      if (settingsCard) {
        this.container.insertBefore(statsDiv, settingsCard);
      } else {
        this.container.appendChild(statsDiv);
      }
    } catch {
      this.notifications.error('Failed to load stats');
    }
  }
}
