export const EMOTES = [
  { id: 0, label: 'GG' },
  { id: 1, label: 'Help!' },
  { id: 2, label: 'Nice!' },
  { id: 3, label: 'Oops' },
  { id: 4, label: 'Taunt' },
  { id: 5, label: 'Thanks' },
  { id: 6, label: 'Wow' },
  { id: 7, label: 'Sorry' },
  { id: 8, label: "Let's Go!" },
  { id: 9, label: 'No!' },
  { id: 10, label: 'Wait' },
  { id: 11, label: 'Boom!' },
] as const;

export type EmoteId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
export const EMOTE_COOLDOWN_MS = 3000;
export const EMOTE_DISPLAY_MS = 2500;
