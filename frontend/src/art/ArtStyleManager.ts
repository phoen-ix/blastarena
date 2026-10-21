import { DEFAULT_ART_STYLE, isArtStyleId } from '@blast-arena/shared';
import type { ArtStyleId } from '@blast-arena/shared';
import { ApiClient } from '../network/ApiClient';
import { getStyle, isStyleAvailable } from './registry';
import type { ArtStyle } from './types';

const STORAGE_KEY = 'blast-arena-art-style';

type Listener = (style: ArtStyleId) => void;

/**
 * Which art style the arena is drawn in. Mirrors ThemeManager: the player's own pick (stored on
 * this device), else the admin default, else Classic. A style this build cannot draw falls back
 * the same way. The landing arena renders before login, so MenuScene waits briefly for
 * `ready()` before starting it.
 */
export class ArtStyleManager {
  private current: ArtStyleId = DEFAULT_ART_STYLE;
  private adminDefault: ArtStyleId = DEFAULT_ART_STYLE;
  private listeners: Listener[] = [];
  private loading: Promise<void> | null = null;

  constructor() {
    this.current = this.resolve();
  }

  /** Fetch the admin default once. Safe to call repeatedly. */
  initialize(): Promise<void> {
    if (!this.loading) this.loading = this.load();
    return this.loading;
  }

  /** Resolves once the admin default is known, or after `timeoutMs`, whichever is first. */
  ready(timeoutMs = 1000): Promise<void> {
    return Promise.race([
      this.initialize(),
      new Promise<void>((done) => setTimeout(done, timeoutMs)),
    ]);
  }

  get(): ArtStyleId {
    return this.current;
  }

  style(): ArtStyle {
    return getStyle(this.current);
  }

  /** The player's own pick on this device, or null when they follow the default. */
  getPreference(): ArtStyleId | null {
    return this.readStored();
  }

  /** Store the player's pick (null forgets it and follows the admin default again). */
  set(style: ArtStyleId | null): void {
    try {
      if (style === null) localStorage.removeItem(STORAGE_KEY);
      else if (isStyleAvailable(style)) localStorage.setItem(STORAGE_KEY, style);
      else return;
    } catch {
      // Storage blocked: the pick still applies for this page load.
      if (style !== null && isStyleAvailable(style)) {
        this.update(style);
        return;
      }
    }
    this.update(this.resolve());
  }

  onChange(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Apply an `admin:settingsChanged` broadcast for the default style. */
  handleAdminSettingChanged(key: string, value: unknown): void {
    if (key !== 'default_art_style' || !isArtStyleId(value)) return;
    this.adminDefault = value;
    this.update(this.resolve());
  }

  private async load(): Promise<void> {
    try {
      const resp = await ApiClient.get<{ style?: unknown }>('/admin/settings/default_art_style');
      if (isArtStyleId(resp.style)) this.adminDefault = resp.style;
    } catch {
      // Offline or older server: keep the built-in default.
    }
    this.update(this.resolve());
  }

  private resolve(): ArtStyleId {
    const stored = this.readStored();
    if (stored) return stored;
    if (isStyleAvailable(this.adminDefault)) return this.adminDefault;
    return DEFAULT_ART_STYLE;
  }

  private update(next: ArtStyleId): void {
    if (next === this.current) return;
    this.current = next;
    for (const l of this.listeners) l(next);
  }

  private readStored(): ArtStyleId | null {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v && isArtStyleId(v) && isStyleAvailable(v) ? v : null;
    } catch {
      return null;
    }
  }
}

export const artStyleManager = new ArtStyleManager();
