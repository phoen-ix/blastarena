import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number = 400, code: string = 'BAD_REQUEST') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * The shape Express and body-parser attach to their own errors, via the `http-errors` package.
 *
 * `expose` is set by `http-errors` to `status < 500` — it means "this status was chosen for the
 * client". Only that flag makes it safe to answer with anything other than an opaque 500.
 */
interface HttpishError {
  message?: unknown;
  statusCode?: unknown;
  status?: unknown;
  expose?: unknown;
  type?: unknown;
}

/**
 * What the client is told, per body-parser failure `type`.
 *
 * Deliberately curated rather than forwarding `err.message`. Two of these messages would otherwise
 * echo something we did not write: a JSON parse failure quotes the offending slice of the request
 * body back at the caller, and a bad `Content-Encoding: gzip` surfaces zlib's internal
 * "incorrect header check". Neither is a data leak, but the `code` is what a client actually
 * branches on, and a fixed message keeps this handler from becoming a reflection point.
 */
const CLIENT_FAULTS: Record<string, { status: number; code: string; error: string }> = {
  'entity.parse.failed': {
    status: 400,
    code: 'INVALID_JSON',
    error: 'Malformed JSON in request body',
  },
  'entity.verify.failed': {
    status: 403,
    code: 'BAD_REQUEST',
    error: 'Request body failed verification',
  },
  'request.aborted': {
    status: 400,
    code: 'REQUEST_ABORTED',
    error: 'Request aborted by the client',
  },
  'request.size.invalid': {
    status: 400,
    code: 'BAD_REQUEST',
    error: 'Request size did not match Content-Length',
  },
  'parameters.too.many': {
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
    error: 'Too many parameters in request body',
  },
  'entity.too.large': {
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
    error: 'Request body is too large',
  },
  'encoding.unsupported': {
    status: 415,
    code: 'UNSUPPORTED_MEDIA_TYPE',
    error: 'Unsupported content encoding',
  },
  'charset.unsupported': {
    status: 415,
    code: 'UNSUPPORTED_MEDIA_TYPE',
    error: 'Unsupported charset',
  },
};

/** Fallback message per status, for an exposable 4xx whose `type` we do not recognise. */
const BY_STATUS: Record<number, { code: string; error: string }> = {
  400: { code: 'BAD_REQUEST', error: 'Bad request' },
  401: { code: 'UNAUTHORIZED', error: 'Unauthorized' },
  403: { code: 'FORBIDDEN', error: 'Forbidden' },
  404: { code: 'NOT_FOUND', error: 'Not found' },
  405: { code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' },
  413: { code: 'PAYLOAD_TOO_LARGE', error: 'Request body is too large' },
  414: { code: 'URI_TOO_LONG', error: 'Request URI is too long' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', error: 'Unsupported media type' },
  431: { code: 'HEADERS_TOO_LARGE', error: 'Request headers are too large' },
};

/**
 * How to answer an error we did not author, or null if it is not safe to treat as a client fault.
 *
 * Strict on purpose: the status must be an integer 4xx *and* the error must be explicitly
 * `expose`-able. A mysql2, ioredis, jsonwebtoken or isolated-vm failure has neither, so it still
 * falls through to the opaque 500 and never reaches the client.
 */
function clientFault(err: HttpishError): { status: number; code: string; error: string } | null {
  if (err.expose !== true) return null;
  const raw =
    typeof err.statusCode === 'number'
      ? err.statusCode
      : typeof err.status === 'number'
        ? err.status
        : null;
  if (raw === null || !Number.isInteger(raw) || raw < 400 || raw > 499) return null;

  if (typeof err.type === 'string') {
    const known = CLIENT_FAULTS[err.type];
    if (known) return known;
  }
  const byStatus = BY_STATUS[raw];
  return byStatus
    ? { status: raw, ...byStatus }
    : { status: raw, code: 'BAD_REQUEST', error: 'Bad request' };
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  // Once the response has started there is nothing useful left to send; handing back to Express
  // lets it destroy the socket instead of throwing ERR_HTTP_HEADERS_SENT over the real error.
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  // A malformed body, an oversized payload or a bad content type is the caller's mistake, not a
  // server fault. Answering 500 meant any unauthenticated client could, with a single `{not json`,
  // make the server emit a level-50 log line carrying a stack trace and the raw body it had just
  // sent — cheap log amplification, and it buried real 5xx in monitoring.
  //
  // Note what is NOT logged here: the error object. `err.body` on a body-parser failure holds the
  // attacker-controlled payload verbatim, and pino has no redaction configured.
  // (audit ERRORHANDLER-4XX-1)
  const fault = clientFault(err as HttpishError);
  if (fault) {
    logger.warn(
      { status: fault.status, code: fault.code, path: req.path, method: req.method },
      'Rejected malformed request',
    );
    res.status(fault.status).json({ error: fault.error, code: fault.code });
    return;
  }

  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
}
