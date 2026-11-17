# FuelForm

A mobile-first fitness and nutrition app. Coaches build workout and meal plan **templates**. Users get **private copies** they can customise, then log workouts and food and track progress.

## Quick start

Requires **Node 22.13+** (uses the built-in `node:sqlite`; nothing else to install).

```bash
npm install
npm run build
npm start            # http://localhost:3001 — seeds demo data on first run
```

Development (hot reload, API on :3001, UI on :5173):

```bash
npm run dev
```

Reset the demo database: `npm run seed`.

### Demo accounts (password `demo1234`)

| Email | Role | What it shows |
|---|---|---|
| `alex@demo.app` | User | 2 weeks of history, customised plan, peanut allergy flags |
| `jordan@demo.app` | User | Vegetarian, imperial units, home workout plan |
| `sam@demo.app` | User | Not onboarded — shows onboarding and empty states |
| `coach@demo.app` | Coach/admin | Templates, assigning, exercise and food libraries |

## Checks

```bash
npm run check        # typecheck + lint + unit/API tests + production build
npm run e2e          # Playwright browser QA at phone and desktop sizes (run after build)
```

E2E screenshots are written to `tests/e2e/screenshots/`.

## Architecture

| Layer | Choice | Why |
|---|---|---|
| UI | React 18 + TypeScript + Vite, plain CSS tokens | Small and maintainable; no UI framework lock-in |
| API | Express 4 | Simple, well known |
| Storage | SQLite (`node:sqlite`, WAL) | Real persistence, zero setup; file at `data/fuelform.db` |
| Validation | Zod schemas in `shared/` | **Same rules in the browser and on the server** |
| Tests | Vitest + Supertest; Playwright E2E | Calculations, validation, permissions, flows |

```
shared/   constants, nutrition maths, goal estimates, zod schemas, API types
server/   db schema, auth, services (data access), routes, seed data
src/      React app: pages/, components/
tests/    unit + API tests, e2e/run.mjs
```

### Data model (key points)

- `workout_plans` / `diet_plans` have `kind = 'template' | 'personal'`. A DB `CHECK` enforces templates have no owner and personal plans do.
- **Assign** and **Add to my plans** deep-copy a template. Edits to a copy never touch the template, and the reverse is also true. "Reset to template" pulls the current template into the copy.
- `food_logs` **snapshot** a food's per-serving nutrition. A coach correcting a food changes plans and future logs, but never rewrites history. Totals are always `servings × per-serving`, computed by one shared function (`shared/nutrition.ts`).
- Foods and exercises still referenced by plans or logs are **archived**, not deleted.

### Security

- Passwords: scrypt with a per-user salt. Sessions: random token in an `HttpOnly`, `SameSite=Lax` cookie; only a hash is stored.
- CSRF: every mutating request must carry `X-Requested-With: fuelform`.
- Login is rate-limited. CSP and other security headers are set. No secrets reach the client.
- Authorisation: personal plans and logs are filtered by owner on every query. Another user's IDs return **404** (no existence leak). Template and library writes are coach-only.
- Coaches see users' names, emails and active plan names only. Never their logs, weights or profiles.
- Set `COOKIE_SECURE=true` when serving over HTTPS.

## Health & safety decisions

- Calorie targets use Mifflin-St Jeor and are labelled estimates. Weight-loss deficits are capped at 500 kcal / 20%. Suggestions never go below 1,500 kcal (1,200 if female), and custom targets below 1,200 kcal are rejected.
- Nutrition values are flagged **≈ approximate**. Food entries are checked for plausibility (macros heavier than the serving, or calories inconsistent with 4/4/9).
- Foods matching a user's allergies or diet are flagged everywhere they appear.
- A "general guidance, not medical advice" notice appears on sign-in, onboarding, dashboard, nutrition and profile.

## Known limitations / next steps

- **No external food database.** The library is a curated local list of ~50 foods. To connect a real source (e.g. USDA FoodData Central), add an API key server-side and an import endpoint. Keep the snapshot model.
- No password reset or email verification (needs an email provider). No multi-coach organisations: any coach can edit any template.
- Login rate limiting is in-memory (per process). Use a shared store if you scale out.
- Dates are the user's local calendar dates sent by the browser. Travelling across time zones can shift which day counts as "today".
- Single SQLite file. Fine for a small team; move to Postgres for multi-instance hosting.
- Dark mode follows the OS setting; there is no in-app toggle.
