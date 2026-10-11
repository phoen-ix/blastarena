import { Request, Response, NextFunction } from 'express';
import { ZodType, ZodError } from 'zod';

export function validate(schema: ZodType, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const data = schema.parse(req[source]);
      if (source === 'query') {
        // Express 5 defines req.query as a getter on the request prototype, so assigning to it
        // throws in strict mode. An own property shadows the getter for the rest of the request.
        Object.defineProperty(req, 'query', {
          value: data,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      } else {
        req[source] = data;
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: err.issues.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }
      next(err);
    }
  };
}
