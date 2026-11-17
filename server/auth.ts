import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { get, run, type DB } from './db.ts';
import { HttpError } from './http.ts';
import type { Role } from '../shared/constants.ts';

export const SESSION_COOKIE = 'ff_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const SCRYPT = { N: 16384, r: 8, p: 1 };

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, SCRYPT);
  return ['scrypt', salt.toString('hex'), hash.toString('hex')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, SCRYPT);
  return timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function createSession(db: DB, userId: number): string {
  const token = randomBytes(32).toString('base64url');
  run(db, 'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, Date.now() + SESSION_TTL_MS);
  run(db, 'DELETE FROM sessions WHERE expires_at < ?', Date.now());
  return token;
}

export function destroySession(db: DB, token: string | undefined) {
  if (token) run(db, 'DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

export function userForToken(db: DB, token: string | undefined): AuthUser | undefined {
  if (!token) return undefined;
  return get<AuthUser>(
    db,
    `SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    sha256(token),
    Date.now(),
  );
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

/** Attaches req.user when a valid session cookie is present. */
export const loadUser = (db: DB) => (req: Request, _res: Response, next: NextFunction) => {
  req.user = userForToken(db, readCookie(req, SESSION_COOKIE));
  next();
};

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue'));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Only coaches can do that'));
  next();
}

/**
 * CSRF defence: state-changing requests must carry a custom header. Browsers
 * will not send custom headers cross-site without a CORS preflight, which this
 * server never approves. Combined with SameSite=Lax cookies.
 */
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'fuelform') return next(new HttpError(403, 'Missing request header'));
  next();
}

/** Small in-memory limiter for login attempts (per IP + email). */
export function createLoginLimiter(max = 10, windowMs = 15 * 60 * 1000) {
  const hits = new Map<string, { count: number; reset: number }>();
  return {
    check(key: string) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || entry.reset < now) {
        hits.set(key, { count: 1, reset: now + windowMs });
        return;
      }
      entry.count += 1;
      if (entry.count > max) throw new HttpError(429, 'Too many sign-in attempts. Please wait a few minutes and try again.');
    },
    clear(key: string) {
      hits.delete(key);
    },
  };
}
