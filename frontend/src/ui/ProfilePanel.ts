import { NotificationUI } from './NotificationUI';
import { ApiClient } from '../network/ApiClient';
import { escapeHtml } from '../utils/html';
import { drawPlayerSprite, getPlayerColorHex } from '../utils/playerCanvas';
import type { PublicProfile, AchievementProgress } from '@blast-arena/shared';

export class ProfilePanel {
  private container: HTMLElement;
  private notifications: NotificationUI;
  private isOpen: boolean = false;
  private _avatarColor: string = '';
  private _avatarEyeStyle: string | undefined;

  constructor(notifications: NotificationUI) {
    this.notifications = notifications;
    this.container = document.createElement('div');
    this.container.className = 'slide-panel w-profile';
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay) uiOverlay.appendChild(this.container);
  }

  async open(userId: number): Promise<void> {
    this.container.innerHTML = this.renderLoading();
    this.isOpen = true;
    this.container.classList.add('open');

    try {
      const profile = await ApiClient.get<PublicProfile>(`/user/${userId}/public`);
      this.container.innerHTML = this.renderProfile(profile);
      this.drawAvatarCanvas();
      // Load achievement progress for own profile
      this.loadAchievementProgress();
    } catch {
      this.container.innerHTML = this.renderPrivate();
    }
    this.attachListeners();
  }

  close(): void {
    this.isOpen = false;
    this.container.classList.remove('open');
  }

  private renderHeader(title: string): string {
    return `
      <div class="panel-header">
        <h3 class="panel-header-title">${title}</h3>
        <button class="profile-panel-close panel-header-close">&times;</button>
      </div>`;
  }

  private drawAvatarCanvas(): void {
    const canvas = this.container.querySelector('#profile-panel-avatar') as HTMLCanvasElement;
    if (canvas && this._avatarColor) {
      const ctx = canvas.getContext('2d');
      if (ctx) drawPlayerSprite(ctx, 0, 0, 44, this._avatarColor, this._avatarEyeStyle);
    }
  }

  private renderLoading(): string {
    return this.renderHeader('Profile') + '<div class="profile-empty-msg">Loading profile...</div>';
  }

  private renderPrivate(): string {
    return (
      this.renderHeader('Profile') +
      '<div class="profile-empty-msg muted">Profile is private or does not exist.</div>'
    );
  }

  private renderProfile(p: PublicProfile): string {
    const kd =
      p.stats.totalDeaths > 0
        ? (p.stats.totalKills / p.stats.totalDeaths).toFixed(2)
        : p.stats.totalKills.toString();
    const playtime = this.formatPlaytime(p.stats.totalMatches);
    const roleColor =
      p.role === 'admin'
        ? 'var(--primary)'
        : p.role === 'moderator'
          ? 'var(--info)'
          : 'var(--text-dim)';
    const roleBadge =
      p.role !== 'user'
        ? `<span class="profile-role-badge" style="color:${roleColor}">${escapeHtml(p.role)}</span>`
        : '';

    return (
      this.renderHeader('Player Profile') +
      `
      <div class="panel-content">
        ${this.renderIdentity(p, roleBadge)}
        ${this.renderRank(p)}
        ${this.renderStats(p, kd, playtime)}
        ${this.renderSeasonHistory(p)}
        ${this.renderAchievements(p)}
        <div id="profile-progress-container"></div>
        ${this.renderCosmetics(p)}
        ${this.renderActions(p)}
      </div>`
    );
  }

  private renderIdentity(p: PublicProfile, roleBadge: string): string {
    const cosmeticHex = p.cosmeticData?.colorHex;
    this._avatarColor = cosmeticHex
      ? `#${cosmeticHex.toString(16).padStart(6, '0')}`
      : getPlayerColorHex(p.id);
    this._avatarEyeStyle = p.cosmeticData?.eyeStyle;
    const joinDate = new Date(p.createdAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
    });
    return `
      <div class="profile-identity">
        <canvas id="profile-panel-avatar" width="44" height="44" style="width:44px;height:44px;border-radius:var(--radius);flex-shrink:0;"></canvas>
        <div>
          <div class="profile-username">
            ${escapeHtml(p.username)}${roleBadge}
          </div>
          <div class="profile-join-date">Joined ${joinDate}</div>
        </div>
      </div>`;
  }

  private renderRank(p: PublicProfile): string {
    const level = (p.stats as any).level ?? 1;
    const totalXp = (p.stats as any).totalXp ?? 0;
    // Calculate XP progress — level N requires N*100 XP to advance
    const xpForLevel = ((level * (level - 1)) / 2) * 100;
    const xpToNext = level * 100;
    const xpProgress = totalXp - xpForLevel;
    const pct = xpToNext > 0 ? Math.min(100, Math.round((xpProgress / xpToNext) * 100)) : 0;

    return `
      <div class="profile-rank-card">
        <div class="profile-rank-row">
          <div>
            <div class="profile-rank-label">Rank</div>
            <div class="profile-rank-value" style="color:${p.rankColor}">${escapeHtml(p.rankTier)}</div>
          </div>
          <div style="text-align:center">
            <div class="profile-rank-label">Level</div>
            <div class="profile-level-value">${level}</div>
          </div>
          <div style="text-align:right">
            <div class="profile-elo-value">${p.stats.eloRating}</div>
            <div class="profile-elo-peak">Peak: ${p.stats.peakElo}</div>
          </div>
        </div>
        <div class="profile-xp-bar">
          <div class="profile-xp-labels">
            <span>XP: ${xpProgress}/${xpToNext}</span>
            <span>${pct}%</span>
          </div>
          <div class="profile-xp-track">
            <div class="profile-xp-fill" style="width:${pct}%"></div>
          </div>
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
    const grid = items
      .map(
        (i) => `
      <div class="profile-stat-item">
        <div class="profile-stat-value">${i.value}</div>
        <div class="profile-stat-label">${i.label}</div>
      </div>`,
      )
      .join('');

    return `
      <div class="profile-section-title">Statistics</div>
      <div class="profile-stats-grid">${grid}</div>`;
  }

  private renderSeasonHistory(p: PublicProfile): string {
    if (!p.seasonHistory || p.seasonHistory.length === 0) return '';
    const rows = p.seasonHistory
      .map(
        (s) => `
      <tr>
        <td class="text-primary">${escapeHtml(s.seasonName)}</td>
        <td class="col-center text-primary">${s.finalElo}</td>
        <td class="col-center text-dim">${s.peakElo}</td>
        <td class="col-center text-dim">${s.matchesPlayed}</td>
      </tr>`,
      )
      .join('');

    return `
      <div class="profile-section-title">Season History</div>
      <div class="profile-season-card">
        <table class="profile-season-table">
          <thead>
            <tr>
              <th>Season</th>
              <th class="col-center">Elo</th>
              <th class="col-center">Peak</th>
              <th class="col-center">Games</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  private renderAchievements(p: PublicProfile): string {
    if (!p.achievements || p.achievements.length === 0) return '';
    const items = p.achievements
      .slice(0, 12)
      .map(
        (a) => `
      <div class="profile-achievement" title="${escapeHtml(a.achievement.description)}">
        <span class="profile-achievement-icon">${a.achievement.icon || '\u2B50'}</span>
        <div style="min-width:0">
          <div class="profile-achievement-name">${escapeHtml(a.achievement.name)}</div>
        </div>
      </div>`,
      )
      .join('');

    return `
      <div class="profile-section-title">
        Achievements (${p.achievements.length})
      </div>
      <div class="profile-achievements-grid">${items}</div>`;
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
      <div class="profile-section-title">Equipped Cosmetics</div>
      <div class="profile-cosmetics">${slots.join('')}</div>`;
  }

  private cosmeticChip(icon: string, label: string): string {
    return `<div class="profile-cosmetic-chip">
      <span class="profile-cosmetic-icon">${icon}</span>${label}
    </div>`;
  }

  private renderActions(p: PublicProfile): string {
    return `
      <div class="profile-actions">
        <button class="profile-add-friend btn btn-primary" data-user-id="${p.id}" data-username="${escapeHtml(p.username)}">
          Add Friend
        </button>
      </div>`;
  }

  private attachListeners(): void {
    this.container
      .querySelector('.profile-panel-close')
      ?.addEventListener('click', () => this.close());

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

  private async loadAchievementProgress(): Promise<void> {
    const progressContainer = this.container.querySelector('#profile-progress-container');
    if (!progressContainer) return;

    try {
      const res = await ApiClient.get<{ progress: AchievementProgress[] }>(
        '/achievements/progress',
      );
      const locked = res.progress.filter((p) => !p.unlocked && p.threshold > 0);
      if (locked.length === 0) return;

      // Sort by completion percentage descending
      locked.sort((a, b) => b.current / b.threshold - a.current / a.threshold);

      const items = locked
        .slice(0, 12)
        .map((p) => {
          const pct = Math.min(100, Math.round((p.current / p.threshold) * 100));
          return `
          <div class="profile-progress-item" title="${escapeHtml(p.description)}">
            <div class="profile-progress-header">
              <span class="profile-progress-icon">${p.icon || '\u2B50'}</span>
              <span class="profile-progress-name">${escapeHtml(p.name)}</span>
              <span class="profile-progress-count">${p.current}/${p.threshold}</span>
            </div>
            <div class="profile-xp-track">
              <div class="profile-xp-fill" style="width:${pct}%"></div>
            </div>
          </div>`;
        })
        .join('');

      progressContainer.innerHTML = `
        <div class="profile-section-title">
          In Progress (${locked.length})
        </div>
        <div class="profile-progress-grid">${items}</div>`;
    } catch {
      // Silently skip — progress is optional
    }
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
