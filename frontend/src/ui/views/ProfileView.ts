import { ILobbyView, ViewDeps } from './types';
import { ApiClient } from '../../network/ApiClient';
import { escapeHtml, escapeAttr, safeCssColor, setHtml } from '../../utils/html';
import { drawPlayerSprite, getPlayerColorHex } from '../../utils/playerCanvas';
import { i18n, t } from '../../i18n';
import type { PublicProfile, AchievementProgress } from '@blast-arena/shared';

export class ProfileView implements ILobbyView {
  readonly viewId = 'profile';
  get title() {
    return t('ui:profile.title');
  }

  private deps: ViewDeps;
  private container: HTMLElement | null = null;
  private userId: number;
  private isOwnProfile: boolean;

  constructor(deps: ViewDeps, options?: Record<string, unknown>) {
    this.deps = deps;
    const user = deps.authManager.getUser();
    this.userId = typeof options?.userId === 'number' ? options.userId : (user?.id ?? 0);
    this.isOwnProfile = this.userId === (user?.id ?? 0);
  }

  async render(container: HTMLElement): Promise<void> {
    this.container = container;
    setHtml(
      this.container,
      `<div class="profile-page"><div class="profile-page-loading">${t('ui:profile.loading')}</div></div>`,
    );

    try {
      const profile = await ApiClient.get<PublicProfile>(`/user/${this.userId}/public`);
      this.renderProfile(profile);
      if (this.isOwnProfile) {
        this.loadAchievementProgress();
      }
    } catch {
      this.renderPrivate();
    }
  }

  destroy(): void {
    this.container = null;
  }

  private renderPrivate(): void {
    if (!this.container) return;
    setHtml(
      this.container,
      `
      <div class="profile-page">
        <div class="profile-page-empty">
          <div class="profile-page-empty-icon">&#128274;</div>
          <div class="profile-page-empty-text">${t('ui:profile.notFound')}</div>
        </div>
      </div>
    `,
    );
  }

  private renderProfile(p: PublicProfile): void {
    if (!this.container) return;

    const kd =
      p.stats.totalDeaths > 0
        ? (p.stats.totalKills / p.stats.totalDeaths).toFixed(2)
        : p.stats.totalKills.toString();
    const playtime = this.formatPlaytime(p.stats.totalPlaytime ?? 0);
    const roleColor =
      p.role === 'admin'
        ? 'var(--primary)'
        : p.role === 'moderator'
          ? 'var(--info)'
          : 'var(--text-dim)';
    const roleBadge =
      p.role !== 'user'
        ? `<span class="profile-role-badge" style="color:${roleColor}">${escapeHtml(t(`common:roles.${p.role}`, { defaultValue: p.role }))}</span>`
        : '';
    // Resolve player color: cosmetic color > fallback by player index
    const cosmeticHex = p.cosmeticData?.colorHex;
    const playerColor = cosmeticHex
      ? `#${cosmeticHex.toString(16).padStart(6, '0')}`
      : getPlayerColorHex(p.id);
    const eyeStyle = p.cosmeticData?.eyeStyle;
    const joinDate = new Date(p.createdAt).toLocaleDateString(i18n.language || undefined, {
      year: 'numeric',
      month: 'short',
    });
    const level = p.stats.level ?? 1;
    const totalXp = p.stats.totalXp ?? 0;
    const xpForLevel = ((level * (level - 1)) / 2) * 100;
    const xpToNext = level * 100;
    const xpProgress = totalXp - xpForLevel;
    const pct = xpToNext > 0 ? Math.min(100, Math.round((xpProgress / xpToNext) * 100)) : 0;

    setHtml(
      this.container,
      `
      <div class="profile-page">
        <div class="profile-page-content">
          <div class="profile-page-header-card">
            <div class="profile-page-identity">
              <canvas id="profile-avatar-canvas" width="56" height="56" style="width:56px;height:56px;border-radius:var(--radius);flex-shrink:0;"></canvas>
              <div class="profile-page-name-group">
                <div class="profile-page-username">${escapeHtml(p.username)}${roleBadge}</div>
                <div class="profile-page-join">${t('ui:profile.joined', { date: joinDate })}</div>
              </div>
            </div>
            <div class="profile-page-rank-group">
              <div class="profile-page-rank-item">
                <div class="profile-page-rank-label">${t('ui:profile.rank')}</div>
                <div class="profile-page-rank-value" style="color:${safeCssColor(p.rankColor, 'var(--primary)')}">${escapeHtml(p.rankTier)}</div>
              </div>
              <div class="profile-page-rank-item" style="text-align:center;">
                <div class="profile-page-rank-label">${t('ui:profile.level')}</div>
                <div class="profile-page-level-value">${level}</div>
              </div>
              <div class="profile-page-rank-item" style="text-align:right;">
                <div class="profile-page-elo-value">${p.stats.eloRating}</div>
                <div class="profile-page-elo-peak">${t('ui:profile.peak', { elo: p.stats.peakElo })}</div>
              </div>
            </div>
            <div class="profile-page-xp-bar">
              <div class="profile-page-xp-labels">
                <span>${t('ui:profile.xpProgress', { current: xpProgress, total: xpToNext })}</span>
                <span>${pct}%</span>
              </div>
              <div class="profile-xp-track">
                <div class="profile-xp-fill" style="width:${pct}%"></div>
              </div>
            </div>
          </div>

          ${this.renderStats(p, kd, playtime)}
          ${this.renderSeasonHistory(p)}
          ${this.renderAchievements(p)}
          <div id="profile-page-progress"></div>
          ${this.renderCosmetics(p)}
          ${!this.isOwnProfile ? this.renderActions(p) : ''}
        </div>
      </div>
    `,
    );

    // Draw player sprite on avatar canvas
    const avatarCanvas = this.container.querySelector(
      '#profile-avatar-canvas',
    ) as HTMLCanvasElement;
    if (avatarCanvas) {
      const ctx = avatarCanvas.getContext('2d');
      if (ctx) {
        drawPlayerSprite(ctx, 0, 0, 56, playerColor, eyeStyle);
      }
    }

    this.bindActions();
  }

  private renderStats(p: PublicProfile, kd: string, playtime: string): string {
    const items = [
      { label: t('ui:profile.matches'), value: p.stats.totalMatches.toString() },
      { label: t('ui:profile.wins'), value: p.stats.totalWins.toString() },
      { label: t('ui:profile.kd'), value: kd },
      { label: t('ui:profile.playtime'), value: playtime },
      { label: t('ui:profile.winStreak'), value: p.stats.winStreak.toString() },
      { label: t('ui:profile.bestStreak'), value: p.stats.bestWinStreak.toString() },
    ];

    return `
      <div class="profile-page-section">
        <div class="profile-page-section-title">${t('ui:profile.statistics')}</div>
        <div class="profile-page-stats-grid">
          ${items
            .map(
              (i) => `
            <div class="profile-page-stat">
              <div class="profile-page-stat-value">${i.value}</div>
              <div class="profile-page-stat-label">${i.label}</div>
            </div>
          `,
            )
            .join('')}
        </div>
      </div>
    `;
  }

  private renderSeasonHistory(p: PublicProfile): string {
    if (!p.seasonHistory || p.seasonHistory.length === 0) return '';

    return `
      <div class="profile-page-section">
        <div class="profile-page-section-title">${t('ui:profile.seasonHistory')}</div>
        <table class="data-table" style="font-size:13px;">
          <thead>
            <tr>
              <th>${t('ui:profile.season')}</th>
              <th style="text-align:center;">${t('ui:profile.elo')}</th>
              <th style="text-align:center;">${t('ui:profile.peakHeader')}</th>
              <th style="text-align:center;">${t('ui:profile.games')}</th>
            </tr>
          </thead>
          <tbody>
            ${p.seasonHistory
              .map(
                (s) => `
              <tr>
                <td style="color:var(--primary);">${escapeHtml(s.seasonName)}</td>
                <td style="text-align:center;color:var(--primary);">${s.finalElo}</td>
                <td style="text-align:center;">${s.peakElo}</td>
                <td style="text-align:center;">${s.matchesPlayed}</td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderAchievements(p: PublicProfile): string {
    if (!p.achievements || p.achievements.length === 0) return '';

    return `
      <div class="profile-page-section">
        <div class="profile-page-section-title">${t('ui:profile.achievementsCount', { count: p.achievements.length })}</div>
        <div class="profile-page-achievements">
          ${p.achievements
            .slice(0, 20)
            .map(
              (a) => `
            <div class="profile-page-achievement" title="${escapeAttr(a.achievement.description)}">
              <span class="profile-page-achievement-icon">${escapeHtml(a.achievement.icon || '\u2B50')}</span>
              <span class="profile-page-achievement-name">${escapeHtml(a.achievement.name)}</span>
            </div>
          `,
            )
            .join('')}
        </div>
      </div>
    `;
  }

  private renderCosmetics(p: PublicProfile): string {
    const c = p.equippedCosmetics;
    if (!c || (!c.colorId && !c.eyesId && !c.trailId && !c.bombSkinId)) return '';

    const slots: string[] = [];
    if (c.colorId) slots.push(this.cosmeticChip('\uD83C\uDFA8', t('ui:profile.cosmeticColor')));
    if (c.eyesId) slots.push(this.cosmeticChip('\uD83D\uDC41\uFE0F', t('ui:profile.cosmeticEyes')));
    if (c.trailId) slots.push(this.cosmeticChip('\u2728', t('ui:profile.cosmeticTrail')));
    if (c.bombSkinId) {
      slots.push(this.cosmeticChip('\uD83D\uDCA3', t('ui:profile.cosmeticBombSkin')));
    }

    return `
      <div class="profile-page-section">
        <div class="profile-page-section-title">${t('ui:profile.equippedCosmetics')}</div>
        <div class="profile-page-cosmetics">${slots.join('')}</div>
      </div>
    `;
  }

  private cosmeticChip(icon: string, label: string): string {
    return `<div class="profile-cosmetic-chip">
      <span class="profile-cosmetic-icon">${icon}</span>${label}
    </div>`;
  }

  private renderActions(p: PublicProfile): string {
    return `
      <div class="profile-page-section">
        <button class="btn btn-primary profile-page-add-friend" data-user-id="${p.id}" data-username="${escapeAttr(p.username)}">
          ${t('ui:profile.addFriend')}
        </button>
      </div>
    `;
  }

  private bindActions(): void {
    if (!this.container) return;

    this.container.querySelector('.profile-page-add-friend')?.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const username = btn.getAttribute('data-username')!;
      btn.disabled = true;
      // The friend request goes over the socket, as in FriendsView. This used to POST
      // /friends/search — a lookup that sends nothing — and toast success regardless.
      this.deps.socketClient.emit('friend:request', { username }, (res) => {
        if (res.success) {
          btn.textContent = t('ui:profile.requestSentBtn');
          btn.style.opacity = '0.6';
          this.deps.notifications.success(t('ui:profile.requestSent', { username }));
        } else {
          btn.disabled = false;
          this.deps.notifications.error(res.error || t('ui:profile.requestFailed'));
        }
      });
    });
  }

  private async loadAchievementProgress(): Promise<void> {
    const progressContainer = this.container?.querySelector('#profile-page-progress');
    if (!progressContainer) return;

    try {
      const res = await ApiClient.get<{ progress: AchievementProgress[] }>(
        '/achievements/progress',
      );
      const locked = res.progress.filter((p) => !p.unlocked && p.threshold > 0);
      if (locked.length === 0) return;

      locked.sort((a, b) => b.current / b.threshold - a.current / a.threshold);

      setHtml(
        progressContainer,
        `
        <div class="profile-page-section">
          <div class="profile-page-section-title">${t('ui:profile.inProgressCount', { count: locked.length })}</div>
          <div class="profile-page-progress-list">
            ${locked
              .slice(0, 12)
              .map((p) => {
                const pctVal = Math.min(100, Math.round((p.current / p.threshold) * 100));
                return `
                <div class="profile-page-progress-item" title="${escapeAttr(p.description)}">
                  <div class="profile-page-progress-header">
                    <span>${escapeHtml(p.icon || '\u2B50')}</span>
                    <span class="profile-page-progress-name">${escapeHtml(p.name)}</span>
                    <span class="profile-page-progress-count">${p.current}/${p.threshold}</span>
                  </div>
                  <div class="profile-xp-track">
                    <div class="profile-xp-fill" style="width:${pctVal}%"></div>
                  </div>
                </div>
              `;
              })
              .join('')}
          </div>
        </div>
      `,
      );
    } catch {
      // Optional — skip silently
    }
  }

  /** Recorded match time. This used to be invented from the match count at 5 minutes each. */
  private formatPlaytime(seconds: number): string {
    const totalMin = Math.floor(seconds / 60);
    if (totalMin < 60) return `${totalMin}m`;
    const hours = Math.floor(totalMin / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  }
}
