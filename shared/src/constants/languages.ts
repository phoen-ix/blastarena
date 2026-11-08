/** The UI and email languages, one list for the backend's i18n, its validators and the client. */
export const SUPPORTED_LANGUAGES = [
  'en',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'pl',
  'nl',
  'tr',
  'sv',
  'nb',
  'da',
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}
