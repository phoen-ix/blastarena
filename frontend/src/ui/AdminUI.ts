import { SocketClient } from '../network/SocketClient';
import { AuthManager } from '../network/AuthManager';
import { NotificationUI } from './NotificationUI';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';
import { UserRole } from '@blast-arena/shared';
import { DashboardTab } from './admin/DashboardTab';
import { UsersTab } from './admin/UsersTab';
import { MatchesTab } from './admin/MatchesTab';
import { RoomsTab } from './admin/RoomsTab';
import { LogsTab } from './admin/LogsTab';
import { AnnouncementsTab } from './admin/AnnouncementsTab';
import { SimulationsTab } from './admin/SimulationsTab';
import { AITab } from './admin/AITab';
import { CampaignTab } from './admin/CampaignTab';
import { SeasonsTab } from './admin/SeasonsTab';
import { AchievementsTab } from './admin/AchievementsTab';
import { t } from '../i18n';

interface Tab {
  id: string;
  label: string;
  adminOnly: boolean;
  instance: { render(parent: HTMLElement): Promise<void>; destroy(): void };
}

export class AdminUI {
  private container: HTMLElement;
  private notifications: NotificationUI;
  private socketClient: SocketClient;
  private authManager: AuthManager;
  private onClose: () => void;
  private tabs: Tab[];
  private activeTabId: string;
  private contentEl: HTMLElement | null = null;
  private onLanguageChanged = () => this.render();

  constructor(
    socketClient: SocketClient,
    authManager: AuthManager,
    notifications: NotificationUI,
    onClose: () => void,
    initialTab?: string,
  ) {
    this.socketClient = socketClient;
    this.authManager = authManager;
    this.notifications = notifications;
    this.onClose = onClose;
    this.container = document.createElement('div');
    this.container.className = 'admin-container';

    const role = (authManager.getUser()?.role || 'user') as UserRole;
    const isAdmin = role === 'admin';

    this.tabs = [
      {
        id: 'dashboard',
        label: t('admin:tabs.dashboard'),
        adminOnly: true,
        instance: new DashboardTab(notifications),
      },
      {
        id: 'users',
        label: t('admin:tabs.users'),
        adminOnly: false,
        instance: new UsersTab(notifications, role),
      },
      {
        id: 'matches',
        label: t('admin:tabs.matches'),
        adminOnly: false,
        instance: new MatchesTab(notifications, isAdmin),
      },
      {
        id: 'rooms',
        label: t('admin:tabs.rooms'),
        adminOnly: false,
        instance: new RoomsTab(notifications, socketClient, role),
      },
      {
        id: 'logs',
        label: t('admin:tabs.logs'),
        adminOnly: true,
        instance: new LogsTab(notifications),
      },
      {
        id: 'simulations',
        label: t('admin:tabs.simulations'),
        adminOnly: true,
        instance: new SimulationsTab(notifications, socketClient),
      },
      {
        id: 'ai',
        label: t('admin:tabs.ai'),
        adminOnly: true,
        instance: new AITab(notifications),
      },
      {
        id: 'announcements',
        label: t('admin:tabs.announcements'),
        adminOnly: false,
        instance: new AnnouncementsTab(notifications, role),
      },
      {
        id: 'campaign',
        label: t('admin:tabs.campaign'),
        adminOnly: true,
        instance: new CampaignTab(notifications),
      },
      {
        id: 'seasons',
        label: t('admin:tabs.seasons'),
        adminOnly: true,
        instance: new SeasonsTab(notifications),
      },
      {
        id: 'achievements',
        label: t('admin:tabs.achievements'),
        adminOnly: true,
        instance: new AchievementsTab(notifications),
      },
    ];

    // Filter tabs based on role
    if (!isAdmin) {
      this.tabs = this.tabs.filter((tab) => !tab.adminOnly);
    }

    this.activeTabId =
      (initialTab && this.tabs.find((tab) => tab.id === initialTab) ? initialTab : null) ||
      this.tabs[0]?.id ||
      'users';
  }

  async show(): Promise<void> {
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay && !uiOverlay.contains(this.container)) {
      uiOverlay.appendChild(this.container);
    }
    window.addEventListener('language-changed', this.onLanguageChanged);
    await this.render();
    this.pushGamepadContext();
  }

  hide(): void {
    window.removeEventListener('language-changed', this.onLanguageChanged);
    UIGamepadNavigator.getInstance().popContext('admin');
    // Destroy active tab
    const activeTab = this.tabs.find((tab) => tab.id === this.activeTabId);
    activeTab?.instance.destroy();
    this.container.remove();
  }

  private async render(): Promise<void> {
    // Refresh tab labels for current language
    for (const tab of this.tabs) {
      tab.label = t(`admin:tabs.${tab.id}`);
    }

    this.container.innerHTML = `
      <div class="admin-header">
        <h1 style="color:var(--primary);margin:0;">${t('admin:title')}</h1>
        <button class="btn btn-secondary" id="admin-close">${t('admin:backToLobby')}</button>
      </div>
      <div class="admin-tabs" id="admin-tab-bar">
        ${this.tabs
          .map(
            (tab) => `
          <button class="admin-tab ${tab.id === this.activeTabId ? 'active' : ''}" data-tab="${tab.id}">${tab.label}</button>
        `,
          )
          .join('')}
      </div>
      <div class="admin-tab-content" id="admin-tab-content"></div>
    `;

    this.container.querySelector('#admin-close')!.addEventListener('click', () => {
      this.hide();
      this.onClose();
    });

    this.container.querySelector('#admin-tab-bar')!.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.dataset.tab && target.dataset.tab !== this.activeTabId) {
        this.switchTab(target.dataset.tab);
      }
    });

    this.contentEl = this.container.querySelector('#admin-tab-content');
    await this.renderActiveTab();
  }

  private async switchTab(tabId: string): Promise<void> {
    // Destroy current tab
    const currentTab = this.tabs.find((tab) => tab.id === this.activeTabId);
    currentTab?.instance.destroy();

    this.activeTabId = tabId;

    // Update tab bar active state
    const tabBar = this.container.querySelector('#admin-tab-bar');
    if (tabBar) {
      tabBar.querySelectorAll('.admin-tab').forEach((btn) => {
        btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tabId);
      });
    }

    // Clear and render new tab
    if (this.contentEl) {
      this.contentEl.innerHTML = '';
    }
    await this.renderActiveTab();
    this.pushGamepadContext();
  }

  private async renderActiveTab(): Promise<void> {
    const tab = this.tabs.find((tab) => tab.id === this.activeTabId);
    if (tab && this.contentEl) {
      await tab.instance.render(this.contentEl);
    }
  }

  private isEmbedded = false;

  async renderEmbedded(container: HTMLElement): Promise<void> {
    this.isEmbedded = true;
    this.container = container;

    const viewContent = document.createElement('div');
    viewContent.className = 'view-content';
    viewContent.innerHTML = `
      <div class="admin-tabs" id="admin-tab-bar">
        ${this.tabs
          .map(
            (tab) => `
          <button class="admin-tab ${tab.id === this.activeTabId ? 'active' : ''}" data-tab="${tab.id}">${tab.label}</button>
        `,
          )
          .join('')}
      </div>
      <div class="admin-tab-content" id="admin-tab-content"></div>
    `;

    this.container.appendChild(viewContent);

    this.container.querySelector('#admin-tab-bar')!.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.dataset.tab && target.dataset.tab !== this.activeTabId) {
        this.switchTab(target.dataset.tab);
      }
    });

    this.contentEl = this.container.querySelector('#admin-tab-content');
    await this.renderActiveTab();
    this.pushGamepadContext();
  }

  destroy(): void {
    const activeTab = this.tabs.find((tab) => tab.id === this.activeTabId);
    activeTab?.instance.destroy();
    UIGamepadNavigator.getInstance().popContext('admin');
  }

  private pushGamepadContext(): void {
    const gpNav = UIGamepadNavigator.getInstance();
    gpNav.popContext('admin');

    const closeBtn = this.container.querySelector<HTMLElement>('#admin-close');

    gpNav.pushContext({
      id: 'admin',
      elements: () => [
        ...(closeBtn ? [closeBtn] : []),
        ...this.container.querySelectorAll<HTMLElement>('.admin-tab'),
        ...(this.contentEl?.querySelectorAll<HTMLElement>(
          'input, select, textarea, button, .btn, .log-row',
        ) || []),
      ],
      onBack: () => {
        if (this.isEmbedded) {
          return;
        }
        this.hide();
        this.onClose();
      },
    });
  }
}
