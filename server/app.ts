import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from './db.ts';
import { loadUser, requireAuth, requireCsrfHeader } from './auth.ts';
import { errorHandler, HttpError } from './http.ts';
import { accountRoutes } from './routes/account.ts';
import { libraryRoutes } from './routes/library.ts';
import { planRoutes } from './routes/plans.ts';
import { trackingRoutes } from './routes/tracking.ts';

export function createApp(db: DB, opts: { staticDir?: string } = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  // Behind a hosting proxy (Railway, Render, Fly) set TRUST_PROXY=1 so req.ip is the visitor's address.
  const trust = process.env.TRUST_PROXY;
  app.set('trust proxy', trust ? (/^\d+$/.test(trust) ? Number(trust) : trust) : 'loopback');

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '200kb' }));
  api.use(requireCsrfHeader);
  api.use(loadUser(db));
  api.get('/health', (_req, res) => { res.json({ ok: true }); });
  api.use(accountRoutes(db));
  api.use(requireAuth); // everything below needs a signed-in user
  api.use(libraryRoutes(db));
  api.use(planRoutes(db));
  api.use(trackingRoutes(db));
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  api.use(errorHandler);
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    api(req, res, next);
  });

  const staticDir = opts.staticDir;
  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(join(staticDir, 'index.html')));
  }
  return app;
}
