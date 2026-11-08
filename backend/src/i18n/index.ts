import i18next, { TFunction } from 'i18next';
import FsBackend from 'i18next-fs-backend';
import path from 'path';
import { SUPPORTED_LANGUAGES } from '@blast-arena/shared';

export const i18n = i18next.createInstance();

export async function initI18n(): Promise<void> {
  await i18n.use(FsBackend).init({
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    ns: ['server', 'email'],
    defaultNS: 'server',
    backend: {
      loadPath: path.resolve(__dirname, '../../locales/{{lng}}/{{ns}}.json'),
    },
    interpolation: {
      escapeValue: false,
    },
    preload: [...SUPPORTED_LANGUAGES],
  });
}

/** Get a t function fixed to a specific locale */
export function getFixedT(lng: string): TFunction {
  return i18n.getFixedT(lng);
}

export const t = i18n.t.bind(i18n);
