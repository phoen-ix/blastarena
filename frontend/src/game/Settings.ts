const STORAGE_KEY = 'blast-arena-settings';

/** How much of the art styles' extra polish to draw (shadows, lights, glow, ambient particles). */
export type GraphicsQuality = 'low' | 'medium' | 'high';
export const GRAPHICS_QUALITIES: readonly GraphicsQuality[] = ['low', 'medium', 'high'];

export interface VisualSettings {
  animations: boolean;
  screenShake: boolean;
  particles: boolean;
  sound: boolean;
  lobbyChat: boolean;
  minimap: boolean;
  quality: GraphicsQuality;
}

function media(query: string): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;
  } catch {
    return false;
  }
}

/**
 * Defaults for a device that never saved settings. A system "reduce motion" preference turns
 * off animations and screen shake; touch-first devices start at Medium quality.
 */
function defaults(): VisualSettings {
  const reduceMotion = media('(prefers-reduced-motion: reduce)');
  return {
    animations: !reduceMotion,
    screenShake: !reduceMotion,
    particles: true,
    sound: true,
    lobbyChat: true,
    minimap: true,
    quality: media('(pointer: coarse)') ? 'medium' : 'high',
  };
}

let cached: VisualSettings | null = null;

export function getSettings(): VisualSettings {
  if (cached) return cached;
  const base = defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        cached = { ...base, ...parsed };
        if (!GRAPHICS_QUALITIES.includes(cached!.quality)) cached!.quality = base.quality;
      } else {
        cached = base;
      }
      return cached!;
    }
  } catch {
    /* ignore */
  }
  cached = base;
  return cached!;
}

export function saveSettings(settings: VisualSettings): void {
  cached = { ...settings };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
}

/** True when the chosen quality is at least `level`. */
export function qualityAtLeast(level: GraphicsQuality): boolean {
  return GRAPHICS_QUALITIES.indexOf(getSettings().quality) >= GRAPHICS_QUALITIES.indexOf(level);
}
