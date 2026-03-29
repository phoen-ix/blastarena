import { Request, Response, NextFunction } from 'express';
import { i18n } from '../i18n';

declare module 'express-serve-static-core' {
  interface Request {
    locale?: string;
  }
}

export function localeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const headerLang = req.headers['x-language'] as string | undefined;
  const acceptLang = req.headers['accept-language']?.split(',')[0]?.split('-')[0];

  const requested = headerLang || acceptLang || 'en';
  const supported = i18n.languages || ['en'];
  const locale = supported.includes(requested) ? requested : 'en';

  req.locale = locale;
  next();
}
