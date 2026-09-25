import { THEME_IDS, DEFAULT_THEME } from '@blast-arena/shared';
import type { ThemeId } from '@blast-arena/shared';
import { THEME_DEFINITIONS } from './definitions';
import type { ThemeCanvasColors } from './definitions';
import { ApiClient } from '../network/ApiClient';

const STORAGE_KEY = 'blast-arena-theme';

type ThemeListener = (theme: ThemeId) => void;

class ThemeManager {
  private static instance: ThemeManager;
  private currentTheme: ThemeId = DEFAULT_THEME;
  private listeners: ThemeListener[] = [];
  private initialized = false;

  static getInstance(): ThemeManager {
    if (!ThemeManager.instance) {
      ThemeManager.instance = new ThemeManager();
    }
    return ThemeManager.instance;
  }

  private constructor() {
    // Read from localStorage immediately (matches flash prevention script)
    const stored = this.readLocalStorage();
    if (stored) {
      this.currentTheme = stored;
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const stored = this.readLocalStorage();
    if (stored) {
      this.currentTheme = stored;
      this.applyTheme(stored);
      return;
    }

    // No user preference — try admin default
    try {
      const resp = await ApiClient.get<{ theme: string }>('/admin/settings/default_theme');
      if (resp.theme && this.isValidTheme(resp.theme)) {
        const changed = resp.theme !== this.currentTheme;
        this.currentTheme = resp.theme as ThemeId;
        this.applyTheme(this.currentTheme);
        // Listeners (canvas colours, the settings picker) otherwise kept the built-in default.
        if (changed) this.notifyListeners();
        return;
      }
    } catch {
      // Ignore — use default
    }

    this.currentTheme = DEFAULT_THEME;
    this.applyTheme(DEFAULT_THEME);
  }

  getTheme(): ThemeId {
    return this.currentTheme;
  }

  getCanvasColors(): ThemeCanvasColors {
    return THEME_DEFINITIONS[this.currentTheme].canvas;
  }

  setTheme(themeId: ThemeId): void {
    if (!this.isValidTheme(themeId)) return;
    this.currentTheme = themeId;
    localStorage.setItem(STORAGE_KEY, themeId);
    this.applyTheme(themeId);
    this.notifyListeners();
  }

  onChange(callback: ThemeListener): void {
    this.listeners.push(callback);
  }

  /** Handle admin:settingsChanged for default_theme */
  handleAdminSettingChanged(key: string, value: string): void {
    if (key !== 'default_theme') return;
    // Only apply if user has no personal preference
    const stored = this.readLocalStorage();
    if (!stored && this.isValidTheme(value)) {
      this.currentTheme = value as ThemeId;
      this.applyTheme(this.currentTheme);
      this.notifyListeners();
    }
  }

  private applyTheme(themeId: ThemeId): void {
    if (themeId === DEFAULT_THEME) {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', themeId);
    }
  }

  private readLocalStorage(): ThemeId | null {
    try {
      const val = localStorage.getItem(STORAGE_KEY);
      if (val && this.isValidTheme(val)) {
        return val as ThemeId;
      }
    } catch {
      // Ignore
    }
    return null;
  }

  private isValidTheme(val: string): val is ThemeId {
    return (THEME_IDS as readonly string[]).includes(val);
  }

  private notifyListeners(): void {
    for (const cb of this.listeners) {
      cb(this.currentTheme);
    }
  }
}

export const themeManager = ThemeManager.getInstance();
