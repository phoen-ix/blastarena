import { describe, it, expect, jest, beforeEach } from '@jest/globals';
type AnyFn = (...args: any[]) => any;

// Mock middleware
const mockAuthMiddleware = jest.fn<AnyFn>((_req, _res, next) => next());
jest.mock('../../../backend/src/middleware/auth', () => ({
  authMiddleware: mockAuthMiddleware,
}));

const mockStaffMiddleware = jest.fn<AnyFn>((_req, _res, next) => next());
jest.mock('../../../backend/src/middleware/admin', () => ({
  staffMiddleware: mockStaffMiddleware,
}));

// Mock fs
const mockReadFile = jest.fn<AnyFn>();
jest.mock('fs', () => ({
  promises: { readFile: mockReadFile },
}));

import docsRouter from '../../../backend/src/routes/docs';

type RouteLayer = {
  route: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: Function; name?: string }>;
  };
};

function getHandler(method: string, path: string) {
  const stack = (docsRouter as any).stack as RouteLayer[];
  const layer = stack.find((l: RouteLayer) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  const routeStack = layer.route.stack;
  return routeStack[routeStack.length - 1].handle;
}

function getRouteStack(method: string, path: string) {
  const stack = (docsRouter as any).stack as RouteLayer[];
  const layer = stack.find((l: RouteLayer) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${path} not found`);
  return layer.route.stack;
}

function mockReq(overrides: Record<string, unknown> = {}): any {
  return { params: {}, user: { userId: 1, username: 'alice', role: 'user' }, ...overrides };
}

function mockRes() {
  const data: { _status: number; _json: unknown; _type: string; _sent: unknown } = {
    _status: 200,
    _json: null,
    _type: '',
    _sent: null,
  };
  const res: any = {
    get _status() {
      return data._status;
    },
    get _json() {
      return data._json;
    },
    get _type() {
      return data._type;
    },
    get _sent() {
      return data._sent;
    },
    status(code: number) {
      data._status = code;
      return res;
    },
    json(body: unknown) {
      data._json = body;
      return res;
    },
    type(t: string) {
      data._type = t;
      return res;
    },
    send(body: unknown) {
      data._sent = body;
      return res;
    },
  };
  return res;
}

describe('Docs Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // GET /docs/:filename (public)
  // -----------------------------------------------------------------------
  describe('GET /docs/:filename', () => {
    it('returns content for a valid public doc', async () => {
      mockReadFile.mockResolvedValue('# Campaign Guide');

      const handler = getHandler('get', '/docs/:filename');
      const req = mockReq({ params: { filename: 'campaign.md' } });
      const res = mockRes();
      await handler(req, res);

      expect(mockReadFile).toHaveBeenCalledWith(expect.stringContaining('campaign.md'), 'utf-8');
      expect(res._sent).toBe('# Campaign Guide');
    });

    it('returns 400 for a filename not in PUBLIC_DOCS', async () => {
      const handler = getHandler('get', '/docs/:filename');
      const req = mockReq({ params: { filename: 'unknown.md' } });
      const res = mockRes();
      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toEqual({ error: 'Invalid document name' });
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('returns 400 for a staff-only doc name via the public route', async () => {
      const handler = getHandler('get', '/docs/:filename');
      const req = mockReq({ params: { filename: 'infrastructure.md' } });
      const res = mockRes();
      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toEqual({ error: 'Invalid document name' });
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('returns 404 when file does not exist on disk', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const handler = getHandler('get', '/docs/:filename');
      const req = mockReq({ params: { filename: 'campaign.md' } });
      const res = mockRes();
      await handler(req, res);

      expect(res._status).toBe(404);
      expect(res._json).toEqual({ error: 'Document not found' });
    });

    it('rejects path traversal attempts', async () => {
      // path.basename('../../etc/passwd') => 'passwd', which is not in PUBLIC_DOCS
      const handler = getHandler('get', '/docs/:filename');
      const req = mockReq({ params: { filename: '../../etc/passwd' } });
      const res = mockRes();
      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toEqual({ error: 'Invalid document name' });
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('sets content-type to text/plain on success', async () => {
      mockReadFile.mockResolvedValue('doc content');

      const handler = getHandler('get', '/docs/:filename');
      const req = mockReq({ params: { filename: 'replay-system.md' } });
      const res = mockRes();
      await handler(req, res);

      expect(res._type).toBe('text/plain');
      expect(res._sent).toBe('doc content');
    });
  });

  // -----------------------------------------------------------------------
  // GET /docs/admin/:filename (staff-only)
  // -----------------------------------------------------------------------
  describe('GET /docs/admin/:filename', () => {
    it('returns content for a valid staff doc', async () => {
      mockReadFile.mockResolvedValue('# Admin Guide');

      const handler = getHandler('get', '/docs/admin/:filename');
      const req = mockReq({ params: { filename: 'admin-and-systems.md' } });
      const res = mockRes();
      await handler(req, res);

      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining('admin-and-systems.md'),
        'utf-8',
      );
      expect(res._sent).toBe('# Admin Guide');
    });

    it('returns 400 for a filename not in STAFF_DOCS', async () => {
      const handler = getHandler('get', '/docs/admin/:filename');
      const req = mockReq({ params: { filename: 'campaign.md' } });
      const res = mockRes();
      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toEqual({ error: 'Invalid document name' });
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('returns 404 when file does not exist on disk', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const handler = getHandler('get', '/docs/admin/:filename');
      const req = mockReq({ params: { filename: 'testing.md' } });
      const res = mockRes();
      await handler(req, res);

      expect(res._status).toBe(404);
      expect(res._json).toEqual({ error: 'Document not found' });
    });

    it('sets content-type to text/plain on success', async () => {
      mockReadFile.mockResolvedValue('openapi spec');

      const handler = getHandler('get', '/docs/admin/:filename');
      const req = mockReq({ params: { filename: 'openapi.yaml' } });
      const res = mockRes();
      await handler(req, res);

      expect(res._type).toBe('text/plain');
      expect(res._sent).toBe('openapi spec');
    });
  });

  // -----------------------------------------------------------------------
  // Middleware presence
  // -----------------------------------------------------------------------
  describe('Middleware presence', () => {
    it('authMiddleware is in the route stack for /docs/:filename', () => {
      const stack = getRouteStack('get', '/docs/:filename');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockAuthMiddleware);
    });

    it('staffMiddleware is in the route stack for /docs/admin/:filename', () => {
      const stack = getRouteStack('get', '/docs/admin/:filename');
      const middlewareFns = stack.slice(0, -1).map((entry: any) => entry.handle);
      expect(middlewareFns).toContain(mockStaffMiddleware);
      expect(middlewareFns).toContain(mockAuthMiddleware);
    });
  });
});
