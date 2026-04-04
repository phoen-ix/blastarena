import i18next, { TFunction } from 'i18next';
import FsBackend from 'i18next-fs-backend';
import path from 'path';

export const i18n = i18next.createInstance();

export async function initI18n(): Promise<void> {
  await i18n.use(FsBackend).init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'nl', 'tr', 'sv', 'nb', 'da'],
    ns: ['server', 'email'],
    defaultNS: 'server',
    backend: {
      loadPath: path.resolve(__dirname, '../../locales/{{lng}}/{{ns}}.json'),
    },
    interpolation: {
      escapeValue: false,
    },
    preload: ['en', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'nl', 'tr', 'sv', 'nb', 'da'],
  });
}

/** Get a t function fixed to a specific locale */
export function getFixedT(lng: string): TFunction {
  return i18n.getFixedT(lng);
}

export const t = i18n.t.bind(i18n);
