import request from 'supertest';
import type { Express } from 'express';
import { openDb, type DB } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { seed, DEMO_PASSWORD } from '../server/seed.ts';

export const TODAY = '2026-11-17'; // a Tuesday (day index 1)

export function setup() {
  const db: DB = openDb(':memory:');
  const ids = seed(db, TODAY);
  const app = createApp(db);
  return { db, app, ids };
}

/** A logged-in supertest agent that sends the CSRF header on every request. */
export async function login(app: Express, email: string, password = DEMO_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('X-Requested-With', 'fuelform').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const h = { 'X-Requested-With': 'fuelform' };
  return {
    get: (url: string) => agent.get(url),
    post: (url: string, body: object = {}) => agent.post(url).set(h).send(body),
    put: (url: string, body: object) => agent.put(url).set(h).send(body),
    patch: (url: string, body: object) => agent.patch(url).set(h).send(body),
    del: (url: string) => agent.delete(url).set(h),
  };
}
