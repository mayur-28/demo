// End-to-end QA: builds nothing itself — run `npm run build` first.
// Starts the production server on a fresh demo database, drives core user
// flows in Chromium at phone and desktop sizes, checks for console errors and
// horizontal overflow, and saves screenshots to tests/e2e/screenshots.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const shots = join(root, 'tests', 'e2e', 'screenshots');
mkdirSync(shots, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'fuelform-e2e-'));
const PORT = 3456;
const BASE = `http://localhost:${PORT}`;
const env = { ...process.env, PORT: String(PORT), DATABASE_FILE: join(tmp, 'e2e.db'), NODE_OPTIONS: '--disable-warning=ExperimentalWarning' };

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };

function startServer() {
  const seedRun = spawn(process.execPath, ['--import', 'tsx', 'server/seed-cli.ts'], { cwd: root, env, stdio: 'inherit' });
  return new Promise((resolve, reject) => {
    seedRun.on('exit', (code) => {
      if (code) return reject(new Error('seed failed'));
      const srv = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: root, env: { ...env, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'inherit'] });
      srv.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(srv); });
      setTimeout(() => reject(new Error('server did not start')), 20000);
    });
  });
}

async function newPage(browser, viewport, label) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.label = label;
  return { ctx, page };
}

/** Wait briefly for an element instead of sampling visibility once. */
const visible = (locator, timeout = 5000) => locator.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);

async function noOverflow(page, name) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check(`${page.label}: no horizontal scroll on ${name}`, sw <= iw + 1, `${sw}px content in ${iw}px viewport`);
}

async function shot(page, name) {
  await page.screenshot({ path: join(shots, `${page.label}-${name}.png`), fullPage: true });
}

async function login(page, who) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(`${who}@demo.app`);
  await page.getByLabel('Password').fill('demo1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function run() {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 860 }]]) {
      const { ctx, page } = await newPage(browser, viewport, label);

      // --- login error state
      await page.goto(`${BASE}/login`);
      await page.getByLabel('Email').fill('alex@demo.app');
      await page.getByLabel('Password').fill('wrong');
      await page.getByRole('button', { name: 'Sign in' }).click();
      check(`${label}: wrong password shows an error`, await visible(page.getByRole('alert').filter({ hasText: 'incorrect' })));
      await shot(page, 'login-error');

      // --- dashboard
      await login(page, 'alex');
      await page.getByRole('heading', { name: 'Hi Alex' }).waitFor();
      await page.getByText('Nutrition today').waitFor();
      check(`${label}: dashboard shows calorie progress`, await visible(page.getByRole('progressbar', { name: 'Calories' }).first()));
      check(`${label}: dashboard shows today's workout`, await visible(page.getByText(/Today's workout/)));
      check(`${label}: allergy flag shown for planned peanut butter`, await visible(page.getByText('⚠ Contains peanut').first()));
      await noOverflow(page, 'dashboard');
      await shot(page, 'dashboard');

      // --- food log: add, edit, delete
      await page.goto(`${BASE}/nutrition`);
      await page.getByRole('button', { name: 'Add food to lunch' }).click();
      await page.getByLabel('Search foods').fill('banana');
      await page.getByRole('button', { name: 'Select Banana' }).click();
      await page.getByLabel('Number of servings').fill('2');
      check(`${label}: live preview calculates 2 bananas = 210 kcal`, await visible(page.getByText('≈210 kcal')));
      await page.getByLabel('Number of servings').fill('-1');
      check(`${label}: negative servings rejected in UI`, await page.getByRole('button', { name: 'Add to log' }).isDisabled());
      await page.getByLabel('Number of servings').fill('2');
      await shot(page, 'add-food-dialog');
      await page.getByRole('button', { name: 'Add to log' }).click();
      await page.getByRole('button', { name: 'Edit Banana' }).waitFor();
      check(`${label}: banana logged`, await visible(page.getByText('≈210 kcal').first()));
      await page.getByRole('button', { name: 'Edit Banana' }).click();
      await page.getByLabel('Number of servings').fill('1');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await page.getByText('Entry updated').waitFor();
      check(`${label}: edit recalculates to 105 kcal`, await visible(page.getByText('≈105 kcal').first()));
      await noOverflow(page, 'food log');
      await shot(page, 'food-log');
      page.once('dialog', (d) => d.accept());
      await page.getByRole('button', { name: 'Remove Banana' }).click();
      await page.getByText('Entry removed').waitFor();
      check(`${label}: entry deleted`, (await page.getByRole('button', { name: 'Edit Banana' }).count()) === 0);
      await page.getByRole('button', { name: 'Week' }).click();
      await page.getByRole('table').waitFor();
      check(`${label}: weekly nutrition table renders`, await visible(page.getByText('Avg calories')));
      await shot(page, 'food-week');

      // --- workout: start today's planned workout, complete and save
      await page.goto(`${BASE}/`);
      await page.getByRole('link', { name: /Start workout|Log again/ }).click();
      await page.getByRole('heading', { name: 'Log workout' }).waitFor();
      await page.getByRole('button', { name: 'Finish & save' }).click();
      check(`${label}: saving with nothing completed shows validation`, await visible(page.getByRole('alert').filter({ hasText: 'at least one exercise complete' })));
      await page.getByRole('button', { name: 'Mark all done' }).click();
      await noOverflow(page, 'workout logger');
      await shot(page, 'workout-log');
      await page.getByRole('button', { name: 'Finish & save' }).click();
      await page.getByRole('heading', { name: 'Workout history' }).waitFor();
      check(`${label}: workout appears in history`, await visible(page.getByText('Workout saved')));
      await shot(page, 'history');

      // --- customise personal plan (reorder) without touching template
      await page.goto(`${BASE}/workouts`);
      await page.getByRole('link', { name: 'Upper / Lower Strength (4 days)' }).first().click();
      await page.getByRole('button', { name: 'Customise' }).click();
      // Move the second exercise of the first day to the top (works whatever order a previous run left).
      const second = (await page.locator('.item-editor').nth(1).locator('.item-head strong').textContent()) ?? '';
      await page.getByRole('button', { name: `Move ${second} up` }).first().click();
      await shot(page, 'plan-editor');
      await page.getByRole('button', { name: 'Save plan' }).click();
      await page.getByText('Plan saved').waitFor();
      const firstEx = await page.locator('.exercise-list').first().locator('.ex-name').first().textContent();
      check(`${label}: reorder saved`, firstEx === second, `${firstEx} (expected ${second})`);

      // --- meal plan, progress, library
      await page.goto(`${BASE}/meals`);
      await page.getByRole('link', { name: 'Balanced ~2,000 kcal' }).first().click();
      await page.getByRole('tablist', { name: 'Day' }).waitFor();
      check(`${label}: meal plan warns about allergy conflicts`, await visible(page.getByRole('note')));
      await noOverflow(page, 'meal plan');
      await shot(page, 'meal-plan');
      await page.goto(`${BASE}/progress`);
      await page.getByText('Strength trends').waitFor();
      await noOverflow(page, 'progress');
      await shot(page, 'progress');
      await page.goto(`${BASE}/exercises`);
      await page.getByLabel('Search exercises').fill('zzzz');
      await page.getByText('No exercises match').waitFor();
      check(`${label}: exercise search empty state`, true);
      await page.getByLabel('Search exercises').fill('squat');
      await page.getByRole('heading', { name: 'Goblet squat' }).waitFor();
      await shot(page, 'exercises');

      // --- simulated API failure shows an error with retry
      await page.route('**/api/progress*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Something went wrong on our side. Please try again."}' }));
      await page.goto(`${BASE}/progress`);
      check(`${label}: server error shows retry`, await visible(page.getByRole('button', { name: 'Try again' })));
      await page.unroute('**/api/progress*');
      await page.getByRole('button', { name: 'Try again' }).click();
      await page.getByText('Strength trends').waitFor();
      check(`${label}: retry recovers`, true);

      // --- keyboard: skip link is first focusable and visible on focus
      await page.goto(`${BASE}/`);
      await page.getByRole('heading', { name: 'Hi Alex' }).waitFor();
      await page.keyboard.press('Tab');
      check(`${label}: skip link receives focus first`, await page.evaluate(() => document.activeElement?.textContent === 'Skip to content'));

      check(`${label}: no console errors (alex)`, page.errors.length === 0, page.errors.join(' | '));
      await ctx.close();
    }

    // --- new user onboarding (phone)
    {
      const { ctx, page } = await newPage(browser, { width: 390, height: 844 }, 'phone');
      await login(page, 'sam');
      await page.getByRole('heading', { name: 'Set up your profile' }).waitFor();
      await page.getByLabel('Age').fill('');
      await page.getByRole('button', { name: 'Continue' }).click();
      check('onboarding: required fields validated', await visible(page.getByText('Age must be a number')));
      await shot(page, 'onboarding-error');
      await page.getByLabel('Age').fill('34');
      await page.getByLabel('Units').selectOption('imperial');
      await page.getByLabel('Height (ft)').fill('5');
      await page.getByLabel('(in)').fill('9');
      await page.getByLabel('Weight (lb)').fill('165');
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByText('Light', { exact: true }).click();
      await page.getByText('Build muscle').click();
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByLabel('Dietary preference (optional)').selectOption('vegetarian');
      await page.getByText('Dairy', { exact: true }).click();
      await page.getByRole('button', { name: 'Continue' }).click();
      check('onboarding: suggested target shown', await visible(page.getByText(/Suggested: ≈/)));
      await noOverflow(page, 'onboarding');
      await shot(page, 'onboarding-targets');
      await page.getByRole('button', { name: 'Finish' }).click();
      await page.getByRole('heading', { name: 'Hi Sam' }).waitFor();
      check('onboarding: empty states on new dashboard', await visible(page.getByText('No active workout plan')) && await visible(page.getByText('No active meal plan')));
      await shot(page, 'dashboard-empty');
      await page.goto(`${BASE}/foods`);
      await page.getByLabel('Search foods').fill('yogurt');
      check('foods: dairy allergy + diet flags for new user', await visible(page.getByText('⚠ Contains dairy').first()));
      await page.getByLabel('Search foods').fill('salmon');
      check('foods: non-vegetarian flagged', await visible(page.getByText('Not vegetarian').first()));
      check('no console errors (sam)', page.errors.length === 0, page.errors.join(' | '));
      await ctx.close();
    }

    // --- coach: create template, assign
    {
      const { ctx, page } = await newPage(browser, { width: 1280, height: 860 }, 'desktop');
      await login(page, 'coach');
      await page.goto(`${BASE}/coach`);
      await page.getByRole('link', { name: '+ New template' }).click();
      await page.getByLabel('Plan name').fill('E2E Template');
      await page.getByRole('button', { name: '+ Add workout day' }).click();
      await page.getByRole('button', { name: '+ Add exercise' }).click();
      await page.getByRole('dialog').getByLabel('Search exercises').fill('plank');
      await page.getByRole('button', { name: 'Choose Plank' }).click();
      await page.getByLabel('Reps').fill('');
      await page.getByRole('button', { name: 'Create template' }).click();
      check('coach: incomplete exercise blocked', await visible(page.getByText(/reps or a duration/).first()));
      await page.getByLabel('Time (sec)').fill('45');
      await page.getByRole('button', { name: 'Create template' }).click();
      await page.getByText('Template created').waitFor();
      await shot(page, 'coach-editor');
      await page.goto(`${BASE}/coach`);
      await page.locator('.plan-row', { hasText: 'E2E Template' }).getByRole('button', { name: 'Assign' }).click();
      await page.getByRole('dialog').getByText('Jordan Lee').click();
      await shot(page, 'coach-assign');
      await page.getByRole('button', { name: 'Assign to 1' }).click();
      await page.getByText(/Assigned to 1 person/).waitFor();
      check('coach: template assigned', true);
      await page.getByRole('button', { name: 'Users' }).click();
      await page.getByRole('cell', { name: 'E2E Template' }).waitFor();
      check('coach: users table shows new active plan', true);
      await shot(page, 'coach-users');
      check('no console errors (coach)', page.errors.length === 0, page.errors.join(' | '));
      await ctx.close();
    }
  } catch (e) {
    check('unexpected failure', false, String(e).split('\n')[0]);
  } finally {
    await browser.close();
    server.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${shots}`);
  process.exit(failed.length ? 1 : 0);
}

run();
