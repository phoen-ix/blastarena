import i18next from 'i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';
import { SUPPORTED_LANGUAGES } from '@blast-arena/shared';

export const i18n = i18next.createInstance();

export async function initI18n(): Promise<void> {
  await i18n
    .use(HttpBackend)
    .use(LanguageDetector)
    .init({
      fallbackLng: 'en',
      supportedLngs: [...SUPPORTED_LANGUAGES],
      // Loaded at boot. `help` and `editor` are fetched on demand by the views that use them
      // (i18n.loadNamespaces) — see LobbyUI.createView and scenes/levelEditorLoader. The former
      // `hud` namespace was an empty `{}` in every locale and is gone. (audit I18N-LOAD-1)
      ns: ['common', 'game', 'ui', 'auth', 'admin', 'campaign', 'errors'],
      defaultNS: 'ui',
      backend: {
        loadPath: '/locales/{{lng}}/{{ns}}.json',
      },
      detection: {
        order: ['localStorage', 'navigator'],
        lookupLocalStorage: 'blast-arena-lang',
        caches: ['localStorage'],
        // Browsers report Norwegian as 'no' or 'nn' as well as 'nb'; only 'nb' is supported, so
        // those users fell back to English.
        convertDetectedLanguage: (lng: string) => (/^(no|nn)(-|$)/i.test(lng) ? 'nb' : lng),
      },
      interpolation: {
        escapeValue: false,
      },
      returnNull: false,
      returnEmptyString: false,
    });

  updateDocumentLocale(i18n.language);

  i18n.on('languageChanged', (lng: string) => {
    updateDocumentLocale(lng);
    window.dispatchEvent(new Event('language-changed'));
  });
}

function updateDocumentLocale(lng: string): void {
  const baseLang = lng.split('-')[0];
  document.documentElement.lang = baseLang;
}

export const t = i18n.t.bind(i18n);
