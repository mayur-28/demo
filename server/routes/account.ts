import { Router } from 'express';
import type { DB } from '../db.ts';
import { get, run } from '../db.ts';
import {
  createLoginLimiter, createSession, destroySession, hashPassword, readCookie, requireAuth, SESSION_COOKIE,
  sessionCookieOptions, verifyPassword, type AuthUser,
} from '../auth.ts';
import { h, HttpError, validate } from '../http.ts';
import { loginSchema, profileSchema, registerSchema } from '../../shared/schemas.ts';
import { getProfile, saveProfile, targetsFor } from '../services.ts';
import type { Me } from '../../shared/types.ts';

// A fixed hash so failed lookups take as long as real password checks.
const DUMMY_HASH = hashPassword('timing-equaliser');

export function meFor(db: DB, user: AuthUser): Me {
  const profile = getProfile(db, user.id);
  const fresh = get<AuthUser>(db, 'SELECT id, email, name, role FROM users WHERE id = ?', user.id) ?? user;
  return { user: fresh, profile, targets: targetsFor(profile) };
}

export function accountRoutes(db: DB) {
  const r = Router();
  const limiter = createLoginLimiter();

  r.post('/auth/register', h((req, res) => {
    const input = validate(registerSchema, req.body);
    if (get(db, 'SELECT id FROM users WHERE email = ?', input.email)) {
      throw new HttpError(409, 'An account with that email already exists', { email: 'Already registered — try signing in' });
    }
    const { id } = run(db, "INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, 'user')", input.email, hashPassword(input.password), input.name);
    res.cookie(SESSION_COOKIE, createSession(db, id), sessionCookieOptions());
    res.status(201);
    return meFor(db, { id, email: input.email, name: input.name, role: 'user' });
  }));

  r.post('/auth/login', h((req, res) => {
    const input = validate(loginSchema, req.body);
    const key = `${req.ip}|${input.email}`;
    limiter.check(key);
    const row = get<AuthUser & { password_hash: string }>(db, 'SELECT id, email, name, role, password_hash FROM users WHERE email = ?', input.email);
    const ok = verifyPassword(input.password, row?.password_hash ?? DUMMY_HASH) && !!row;
    if (!ok || !row) throw new HttpError(401, 'Email or password is incorrect');
    limiter.clear(key);
    res.cookie(SESSION_COOKIE, createSession(db, row.id), sessionCookieOptions());
    return meFor(db, row);
  }));

  r.post('/auth/logout', h((req, res) => {
    destroySession(db, readCookie(req, SESSION_COOKIE));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }));

  r.get('/me', requireAuth, h((req) => meFor(db, req.user!)));

  r.put('/me/profile', requireAuth, h((req) => {
    const input = validate(profileSchema, req.body);
    saveProfile(db, req.user!.id, input);
    return meFor(db, req.user!);
  }));

  return r;
}
