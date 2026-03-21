export const EMOTES = [
  { id: 0, label: 'GG' },
  { id: 1, label: 'Help!' },
  { id: 2, label: 'Nice!' },
  { id: 3, label: 'Oops' },
  { id: 4, label: 'Taunt' },
  { id: 5, label: 'Thanks' },
] as const;

export type EmoteId = 0 | 1 | 2 | 3 | 4 | 5;
export const EMOTE_COOLDOWN_MS = 3000;
export const EMOTE_DISPLAY_MS = 2500;
