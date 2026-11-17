import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { formatZodError } from '../shared/schemas.ts';

export class HttpError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
export const forbidden = () => new HttpError(403, 'You do not have permission to do that');

export function validate<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const { message, fields } = formatZodError(r.error);
    throw new HttpError(400, message, fields);
  }
  return r.data;
}

export function idParam(req: Request, name = 'id'): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n < 1) throw notFound();
  return n;
}

type Handler = (req: Request, res: Response) => unknown;
/** Wrap a sync/async handler; returned values are sent as JSON. */
export const h = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) {
      if (out === undefined) res.status(204).end();
      else res.json(out);
    }
  } catch (err) {
    next(err);
  }
};

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, fields: err.fields });
    return;
  }
  if (err instanceof ZodError) {
    const { message, fields } = formatZodError(err);
    res.status(400).json({ error: message, fields });
    return;
  }
  if (err instanceof SyntaxError && 'body' in (err as object)) {
    res.status(400).json({ error: 'Request body is not valid JSON' });
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/FOREIGN KEY constraint failed/.test(msg)) {
    res.status(400).json({ error: 'Referenced item does not exist' });
    return;
  }
  if (/CHECK constraint failed/.test(msg)) {
    res.status(400).json({ error: 'A value is outside the allowed range' });
    return;
  }
  if (process.env.NODE_ENV !== 'test') console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
}
