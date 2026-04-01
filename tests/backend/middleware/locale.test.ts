import { describe, it, expect, jest, beforeEach } from '@jest/globals';
type AnyFn = (...args: any[]) => any;

const mockLanguages = ['en', 'de', 'fr', 'es', 'ja'];
jest.mock('../../../backend/src/i18n', () => ({
  i18n: { languages: mockLanguages },
}));

import { localeMiddleware } from '../../../backend/src/middleware/locale';

function createMockRes() {
  return {} as any;
}

describe('localeMiddleware', () => {
  let mockRes: ReturnType<typeof createMockRes>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRes = createMockRes();
    mockNext = jest.fn();
  });

  it('should set locale from x-language header when supported', () => {
    const req = { headers: { 'x-language': 'de' } } as any;

    localeMiddleware(req, mockRes, mockNext);

    expect(req.locale).toBe('de');
  });

  it('should set locale from accept-language when no x-language header', () => {
    const req = { headers: { 'accept-language': 'fr' } } as any;

    localeMiddleware(req, mockRes, mockNext);

    expect(req.locale).toBe('fr');
  });

  it('should extract base language from accept-language with region subtag', () => {
    const req = { headers: { 'accept-language': 'en-US' } } as any;

    localeMiddleware(req, mockRes, mockNext);

    expect(req.locale).toBe('en');
  });

  it('should default to en when no language headers are present', () => {
    const req = { headers: {} } as any;

    localeMiddleware(req, mockRes, mockNext);

    expect(req.locale).toBe('en');
  });

  it('should default to en when requested language is not in supported list', () => {
    const req = { headers: { 'x-language': 'zh' } } as any;

    localeMiddleware(req, mockRes, mockNext);

    expect(req.locale).toBe('en');
  });

  it('should prefer x-language over accept-language', () => {
    const req = {
      headers: { 'x-language': 'de', 'accept-language': 'fr' },
    } as any;

    localeMiddleware(req, mockRes, mockNext);

    expect(req.locale).toBe('de');
  });

  it('should call next() in all cases', () => {
    const requests = [
      { headers: { 'x-language': 'de' } },
      { headers: { 'accept-language': 'fr' } },
      { headers: {} },
      { headers: { 'x-language': 'zh' } },
    ];

    for (const req of requests) {
      localeMiddleware(req as any, mockRes, mockNext);
    }

    expect(mockNext).toHaveBeenCalledTimes(requests.length);
  });

  it('should handle accept-language with quality values by extracting base language', () => {
    // 'fr-FR;q=0.9,en;q=0.8' → split(',')[0] = 'fr-FR;q=0.9' → split('-')[0] = 'fr'
    const req = { headers: { 'accept-language': 'fr-FR;q=0.9,en;q=0.8' } } as any;

    localeMiddleware(req, mockRes, mockNext);

    expect(req.locale).toBe('fr');
  });
});
