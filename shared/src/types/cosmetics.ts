export type CosmeticType = 'color' | 'eyes' | 'trail' | 'bomb_skin';
export type CosmeticRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type CosmeticUnlockType = 'achievement' | 'campaign_stars' | 'default';

export interface Cosmetic {
  id: number;
  name: string;
  type: CosmeticType;
  config: Record<string, unknown>;
  rarity: CosmeticRarity;
  unlockType: CosmeticUnlockType;
  unlockRequirement: Record<string, unknown> | null;
  isActive: boolean;
  sortOrder: number;
}

export interface EquippedCosmetics {
  colorId: number | null;
  eyesId: number | null;
  trailId: number | null;
  bombSkinId: number | null;
}

export interface PlayerCosmeticData {
  colorHex?: number;
  eyeStyle?: string;
  trailConfig?: { particleKey: string; tint: number; frequency: number };
  bombSkinConfig?: { baseColor: number; fuseColor: number; label: string };
}
