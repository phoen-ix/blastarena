import { Request, Response, NextFunction } from 'express';
import { isSupportedLanguage } from '@blast-arena/shared';

declare module 'express-serve-static-core' {
  interface Request {
    locale?: string;
  }
}

export function localeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const headerLang = req.headers['x-language'] as string | undefined;
  const acceptLang = req.headers['accept-language']?.split(',')[0]?.split('-')[0];

  const requested = headerLang || acceptLang || 'en';
  // The supported list, not i18n.languages: that is the current language's fallback chain, which
  // is ['en'] on the server, so every request was 'en' and every email sent over REST (sign-up,
  // email change, test mail) went out in English. (audit H1)
  req.locale = isSupportedLanguage(requested) ? requested : 'en';
  next();
}
