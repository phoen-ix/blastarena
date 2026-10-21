import type { World } from '../../painters/types';

/** Surface motif drawn on floors and walls of a world. */
export type NeonMotif =
  'panel' | 'moss' | 'sand' | 'crystal' | 'magma' | 'void' | 'rune' | 'swamp' | 'cloud';

export interface NeonWorld {
  floor: string;
  floor2: string;
  /** Grid seam line and its glow. */
  seam: string;
  seamGlow: string;
  /** Indestructible block glass, top and bottom of its gradient. */
  wallTop: string;
  wallBot: string;
  /** Emissive edge on blocks, and its bright highlight. */
  edge: string;
  edge2: string;
  /** Breakable crate body. */
  crate: string;
  crate2: string;
  /** Crate light strip (breakable blocks read in this colour). */
  circuit: string;
  rim: string;
  motif: NeonMotif;
}

/** One palette per campaign world. Classic is the open-arena default. */
export const WORLDS: Record<World, NeonWorld> = {
  classic: {
    floor: '#0a0e1d',
    floor2: '#0d1327',
    seam: '#1a2a4c',
    seamGlow: '#2ee6c4',
    wallTop: '#1f2a52',
    wallBot: '#0b1027',
    edge: '#00d4aa',
    edge2: '#7ff7e0',
    crate: '#22162c',
    crate2: '#120b19',
    circuit: '#ff6b35',
    rim: '#3b2944',
    motif: 'panel',
  },
  forest: {
    floor: '#06120c',
    floor2: '#081a10',
    seam: '#0f3424',
    seamGlow: '#5dff9a',
    wallTop: '#14392b',
    wallBot: '#061a11',
    edge: '#5dff9a',
    edge2: '#d4ff6a',
    crate: '#16230f',
    crate2: '#0a1407',
    circuit: '#b6ff3a',
    rim: '#2b3d1f',
    motif: 'moss',
  },
  desert: {
    floor: '#130d07',
    floor2: '#1b1209',
    seam: '#3c2a14',
    seamGlow: '#ffb648',
    wallTop: '#3d2a15',
    wallBot: '#170f07',
    edge: '#ffb648',
    edge2: '#ffe2a0',
    crate: '#21170d',
    crate2: '#110b05',
    circuit: '#45f0d4',
    rim: '#43301b',
    motif: 'sand',
  },
  ice: {
    floor: '#08131f',
    floor2: '#0b1a2c',
    seam: '#173e5e',
    seamGlow: '#7fe8ff',
    wallTop: '#1d4a70',
    wallBot: '#0a1d33',
    edge: '#8ff0ff',
    edge2: '#ffffff',
    crate: '#11243a',
    crate2: '#081626',
    circuit: '#9fe9ff',
    rim: '#2e4b69',
    motif: 'crystal',
  },
  volcano: {
    floor: '#100808',
    floor2: '#170a09',
    seam: '#2e100a',
    seamGlow: '#ff5a1f',
    wallTop: '#221619',
    wallBot: '#0b0608',
    edge: '#ff5a1f',
    edge2: '#ffc061',
    crate: '#221009',
    crate2: '#140805',
    circuit: '#ffb347',
    rim: '#3d1e14',
    motif: 'magma',
  },
  void: {
    floor: '#07040e',
    floor2: '#0c0619',
    seam: '#26173f',
    seamGlow: '#ff4fd8',
    wallTop: '#211038',
    wallBot: '#0a0518',
    edge: '#ff4fd8',
    edge2: '#ffc2f4',
    crate: '#160b25',
    crate2: '#0a0513',
    circuit: '#8da2ff',
    rim: '#33204f',
    motif: 'void',
  },
  castle: {
    floor: '#0e0c18',
    floor2: '#131022',
    seam: '#272042',
    seamGlow: '#b48cff',
    wallTop: '#272144',
    wallBot: '#100d1d',
    edge: '#b48cff',
    edge2: '#ffd36a',
    crate: '#1e182b',
    crate2: '#110d1a',
    circuit: '#ffcf5a',
    rim: '#3d3456',
    motif: 'rune',
  },
  swamp: {
    floor: '#090e07',
    floor2: '#0e1509',
    seam: '#243219',
    seamGlow: '#c8ff3a',
    wallTop: '#222f19',
    wallBot: '#0b1107',
    edge: '#c8ff3a',
    edge2: '#f2ffa6',
    crate: '#1d190d',
    crate2: '#0f0d06',
    circuit: '#ff9f3d',
    rim: '#353020',
    motif: 'swamp',
  },
  sky: {
    floor: '#0e1a2d',
    floor2: '#13233b',
    seam: '#2d4c76',
    seamGlow: '#bff4ff',
    wallTop: '#3b6898',
    wallBot: '#162f50',
    edge: '#e2fbff',
    edge2: '#ffffff',
    crate: '#1d3453',
    crate2: '#0e1c32',
    circuit: '#ffd76a',
    rim: '#36557c',
    motif: 'cloud',
  },
};

export function pal(world: World): NeonWorld {
  return WORLDS[world] ?? WORLDS.classic;
}

export const TAU = Math.PI * 2;
