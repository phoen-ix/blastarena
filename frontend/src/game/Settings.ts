const STORAGE_KEY = 'blast-arena-settings';

export interface VisualSettings {
  animations: boolean;
  screenShake: boolean;
  particles: boolean;
  sound: boolean;
  lobbyChat: boolean;
  minimap: boolean;
}

const DEFAULTS: VisualSettings = {
  animations: true,
  screenShake: true,
  particles: true,
  sound: true,
  lobbyChat: true,
  minimap: true,
};

let cached: VisualSettings | null = null;

export function getSettings(): VisualSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        cached = { ...DEFAULTS, ...parsed };
      } else {
        cached = { ...DEFAULTS };
      }
      return cached!;
    }
  } catch {
    /* ignore */
  }
  cached = { ...DEFAULTS };
  return cached!;
}

export function saveSettings(settings: VisualSettings): void {
  cached = { ...settings };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
}
