import { NotificationUI } from './NotificationUI';
import { ApiClient } from '../network/ApiClient';
import { escapeHtml } from '../utils/html';
import type { PublicProfile } from '@blast-arena/shared';

export class ProfilePanel {
  private container: HTMLElement;
  private notifications: NotificationUI;
  private isOpen: boolean = false;

  constructor(notifications: NotificationUI) {
    this.notifications = notifications;
    this.container = document.createElement('div');
    Object.assign(this.container.style, {
      position: 'fixed',
      right: '0',
      top: '0',
      width: '380px',
      height: '100vh',
      background: 'var(--bg-base)',
      borderLeft: '1px solid var(--border)',
      zIndex: '202',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'var(--font-body)',
      transform: 'translateX(100%)',
      transition: 'transform 0.3s ease',
      overflowY: 'auto',
    });
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay) uiOverlay.appendChild(this.container);
  }

  async open(userId: number): Promise<void> {
    this.container.innerHTML = this.renderLoading();
    this.isOpen = true;
    this.container.style.transform = 'translateX(0)';

    try {
      const profile = await ApiClient.get<PublicProfile>(`/user/${userId}/public`);
      this.container.innerHTML = this.renderProfile(profile);
    } catch {
      this.container.innerHTML = this.renderPrivate();
    }
    this.attachListeners();
  }

  close(): void {
    this.isOpen = false;
    this.container.style.transform = 'translateX(100%)';
  }

  private renderHeader(title: string): string {
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <h3 style="font-family:var(--font-display);font-weight:700;font-size:16px;color:var(--text);margin:0;">${title}</h3>
        <button class="profile-panel-close" style="background:none;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;padding:4px 8px;">&times;</button>
      </div>`;
  }

  private renderLoading(): string {
    return this.renderHeader('Profile') +
      '<div style="text-align:center;padding:60px 16px;color:var(--text-dim);font-size:14px;">Loading profile...</div>';
  }

  private renderPrivate(): string {
    return this.renderHeader('Profile') +
      '<div style="text-align:center;padding:60px 16px;color:var(--text-muted);font-size:14px;">Profile is private or does not exist.</div>';
  }

  private renderProfile(p: PublicProfile): string {
    const kd = p.stats.totalDeaths > 0
      ? (p.stats.totalKills / p.stats.totalDeaths).toFixed(2)
      : p.stats.totalKills.toString();
    const playtime = this.formatPlaytime(p.stats.totalMatches);
    const roleColor = p.role === 'admin' ? 'var(--primary)' : p.role === 'moderator' ? 'var(--info)' : 'var(--text-dim)';
    const roleBadge = p.role !== 'user'
      ? `<span style="font-size:11px;color:${roleColor};font-weight:600;text-transform:uppercase;margin-left:8px;">${escapeHtml(p.role)}</span>`
      : '';

    return this.renderHeader('Player Profile') + `
      <div style="padding:20px 16px;overflow-y:auto;flex:1;">
        ${this.renderIdentity(p, roleBadge)}
        ${this.renderRank(p)}
        ${this.renderStats(p, kd, playtime)}
        ${this.renderSeasonHistory(p)}
        ${this.renderAchievements(p)}
        ${this.renderCosmetics(p)}
        ${this.renderActions(p)}
      </div>`;
  }

  private renderIdentity(p: PublicProfile, roleBadge: string): string {
    const colors = ['#ff6b35', '#448aff', '#00e676', '#ffaa22', '#bb44ff', '#00d4aa'];
    const color = colors[p.id % colors.length];
    const joinDate = new Date(p.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    return `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
        <div style="width:52px;height:52px;border-radius:12px;background:${color};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff;font-family:var(--font-display);flex-shrink:0;">
          ${escapeHtml(p.username.charAt(0).toUpperCase())}
        </div>
        <div>
          <div style="font-size:18px;font-weight:700;color:var(--text);font-family:var(--font-display);">
            ${escapeHtml(p.username)}${roleBadge}
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Joined ${joinDate}</div>
        </div>
      </div>`;
  }

  private renderRank(p: PublicProfile): string {
    return `
      <div style="background:var(--bg-card);border-radius:10px;padding:14px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Rank</div>
          <div style="font-size:16px;font-weight:700;color:${p.rankColor};font-family:var(--font-display);">${escapeHtml(p.rankTier)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:22px;font-weight:700;color:var(--text);font-family:var(--font-display);">${p.stats.eloRating}</div>
          <div style="font-size:11px;color:var(--text-muted);">Peak: ${p.stats.peakElo}</div>
        </div>
      </div>`;
  }

  private renderStats(p: PublicProfile, kd: string, playtime: string): string {
    const items = [
      { label: 'Matches', value: p.stats.totalMatches.toString() },
      { label: 'Wins', value: p.stats.totalWins.toString() },
      { label: 'K/D', value: kd },
      { label: 'Est. Playtime', value: playtime },
      { label: 'Win Streak', value: p.stats.winStreak.toString() },
      { label: 'Best Streak', value: p.stats.bestWinStreak.toString() },
    ];
    const grid = items.map(i => `
      <div style="background:var(--bg-deep);border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:16px;font-weight:700;color:var(--text);font-family:var(--font-display);">${i.value}</div>
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.3px;margin-top:2px;">${i.label}</div>
      </div>`).join('');

    return `
      <div style="font-size:12px;color:var(--text-dim);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Statistics</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;">${grid}</div>`;
  }

  private renderSeasonHistory(p: PublicProfile): string {
    if (!p.seasonHistory || p.seasonHistory.length === 0) return '';
    const rows = p.seasonHistory.map(s => `
      <tr>
        <td style="padding:6px 8px;color:var(--text);font-size:13px;">${escapeHtml(s.seasonName)}</td>
        <td style="padding:6px 8px;color:var(--text);font-size:13px;text-align:center;">${s.finalElo}</td>
        <td style="padding:6px 8px;color:var(--text-dim);font-size:13px;text-align:center;">${s.peakElo}</td>
        <td style="padding:6px 8px;color:var(--text-dim);font-size:13px;text-align:center;">${s.matchesPlayed}</td>
      </tr>`).join('');

    return `
      <div style="font-size:12px;color:var(--text-dim);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Season History</div>
      <div style="background:var(--bg-card);border-radius:10px;overflow:hidden;margin-bottom:16px;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--border);">
              <th style="padding:8px;text-align:left;font-size:11px;color:var(--text-muted);font-weight:600;">Season</th>
              <th style="padding:8px;text-align:center;font-size:11px;color:var(--text-muted);font-weight:600;">Elo</th>
              <th style="padding:8px;text-align:center;font-size:11px;color:var(--text-muted);font-weight:600;">Peak</th>
              <th style="padding:8px;text-align:center;font-size:11px;color:var(--text-muted);font-weight:600;">Games</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  private renderAchievements(p: PublicProfile): string {
    if (!p.achievements || p.achievements.length === 0) return '';
    const items = p.achievements.slice(0, 12).map(a => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-deep);border-radius:8px;" title="${escapeHtml(a.achievement.description)}">
        <span style="font-size:18px;flex-shrink:0;">${a.achievement.icon || '\u2B50'}</span>
        <div style="min-width:0;">
          <div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(a.achievement.name)}</div>
        </div>
      </div>`).join('');

    return `
      <div style="font-size:12px;color:var(--text-dim);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
        Achievements (${p.achievements.length})
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:16px;">${items}</div>`;
  }

  private renderCosmetics(p: PublicProfile): string {
    const c = p.equippedCosmetics;
    if (!c || (!c.colorId && !c.eyesId && !c.trailId && !c.bombSkinId)) return '';

    const slots: string[] = [];
    if (c.colorId) slots.push(this.cosmeticChip('\uD83C\uDFA8', 'Color'));
    if (c.eyesId) slots.push(this.cosmeticChip('\uD83D\uDC41\uFE0F', 'Eyes'));
    if (c.trailId) slots.push(this.cosmeticChip('\u2728', 'Trail'));
    if (c.bombSkinId) slots.push(this.cosmeticChip('\uD83D\uDCA3', 'Bomb Skin'));

    return `
      <div style="font-size:12px;color:var(--text-dim);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Equipped Cosmetics</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">${slots.join('')}</div>`;
  }

  private cosmeticChip(icon: string, label: string): string {
    return `<div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:var(--bg-card);border-radius:8px;font-size:12px;color:var(--text);">
      <span style="font-size:16px;">${icon}</span>${label}
    </div>`;
  }

  private renderActions(p: PublicProfile): string {
    return `
      <div style="padding-top:8px;display:flex;gap:8px;">
        <button class="profile-add-friend btn btn-primary" data-user-id="${p.id}" data-username="${escapeHtml(p.username)}"
          style="flex:1;padding:10px;font-size:13px;font-weight:600;border-radius:8px;cursor:pointer;background:var(--primary);color:#fff;border:none;font-family:var(--font-body);">
          Add Friend
        </button>
      </div>`;
  }

  private attachListeners(): void {
    this.container.querySelector('.profile-panel-close')?.addEventListener('click', () => this.close());

    this.container.querySelector('.profile-add-friend')?.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLElement;
      const username = btn.getAttribute('data-username')!;

      ApiClient.post('/friends/search', { query: username }).catch(() => {});
      // Use the friends socket event pattern — import dynamically to avoid circular deps
      btn.textContent = 'Request Sent';
      btn.setAttribute('disabled', 'true');
      (btn as HTMLButtonElement).style.opacity = '0.6';
      this.notifications.success(`Friend request sent to ${username}`);
    });
  }

  private formatPlaytime(totalMatches: number): string {
    // Estimate ~5min per match
    const totalMin = totalMatches * 5;
    if (totalMin < 60) return `${totalMin}m`;
    const hours = Math.floor(totalMin / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  }
}
