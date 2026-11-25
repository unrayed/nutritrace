/**
 * Admin Overview is a read-only instance browser. These cases exercise the
 * contract in docs/specs/admin-overview.md and the field-level bar in
 * docs/specs/admin-overview-verification.md: useful parsed data, not ids or
 * raw JSON blobs, and never a secret.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

let db = null, dir = null, server = null, base = null, LIMITS = null;
let admin = 0, regular = 0, target = 0, capUser = 0;
let foodA = 0, foodB = 0, foodC = 0, mealId = 0, recipeId = 0;
const DAY1 = '2026-11-20', DAY2 = '2026-11-21', DAY3 = '2026-11-22';

try {
  const req = createRequire(new URL('../server/package.json', import.meta.url));
  req('better-sqlite3');
  dir = mkdtempSync(join(tmpdir(), 'admin-overview-'));
  process.env.DB_PATH = join(dir, 'test.db');
  db = (await import('../server/db.js')).default;
  const express = req('express');
  const { default: overviewRoutes, LIMITS: limits } = await import('../server/routes/admin-overview.js');
  LIMITS = limits;

  const mkUser = (name, role = 'user') => Number(db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)'
  ).run(name, 'x', name, role).lastInsertRowid);

  admin = mkUser('admin', 'admin');
  regular = mkUser('regular');
  target = mkUser('target');
  capUser = mkUser('cap');

  const mkFood = (userId, name, extra = {}) => Number(db.prepare(
    `INSERT INTO foods (user_id, name, brand, category, barcode, portion, unit, nutrition, img_url, notes, alt_units, nutrition_basis)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId, name, extra.brand ?? null, extra.category ?? null, extra.barcode ?? null,
    extra.portion ?? 100, extra.unit ?? 'g',
    JSON.stringify(extra.nutrition ?? { calories: 100, proteins: 1, carbohydrates: 2, fat: 3 }),
    extra.img_url ?? null, extra.notes ?? null,
    extra.alt_units ? JSON.stringify(extra.alt_units) : null,
    extra.nutrition_basis ?? 'g'
  ).lastInsertRowid);

  foodA = mkFood(target, 'Oats', {
    brand: 'Farm', category: 'Cereal', barcode: '123', portion: 40, unit: 'g',
    nutrition: { calories: 150, proteins: 5, carbohydrates: 27, fat: 3, fiber: 4, sugars: 1, sodium: 2 },
    notes: 'breakfast', alt_units: [{ abbr: 'cup', grams: 240 }],
  });
  foodB = mkFood(target, 'Rice', {
    nutrition: { calories: 200, proteins: 4, carbohydrates: 44, fat: 1 },
    img_url: 'data:image/png;base64,AAAA',
  });
  foodC = mkFood(target, 'Apple', {
    nutrition: { calories: 52, proteins: 0, carbohydrates: 14, fat: 0 },
  });

  const mealItems = [
    { id: foodA, food_server_id: foodA, name: 'Oats', portion: 40, unit: 'g', quantity: 2,
      nutrition: { calories: 150, proteins: 5, carbohydrates: 27, fat: 3 },
      imgUrl: 'data:image/png;base64,AAAA' },
    { id: foodB, food_server_id: foodB, name: 'Rice', portion: 100, unit: 'g', quantity: 1,
      nutrition: { calories: 200, proteins: 4, carbohydrates: 44, fat: 1 } },
  ];
  mealId = Number(db.prepare(
    `INSERT INTO meals (user_id, name, nutrition, items, img_url, notes, is_recipe, portion, unit, servings)
     VALUES (?, ?, ?, ?, ?, ?, 0, 100, 'g', 1)`
  ).run(target, 'Breakfast bowl',
    JSON.stringify({ calories: 500, proteins: 14, carbohydrates: 115, fat: 7 }),
    JSON.stringify(mealItems), null, 'bowl note').lastInsertRowid);
  recipeId = Number(db.prepare(
    `INSERT INTO meals (user_id, name, nutrition, items, img_url, notes, is_recipe, portion, unit, servings)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'serving', 2)`
  ).run(target, 'Rice recipe',
    JSON.stringify({ calories: 400, proteins: 8, carbohydrates: 88, fat: 2 }),
    JSON.stringify([mealItems[1]]), 'data:image/png;base64,BBBB', null).lastInsertRowid);

  const dayItems = [
    {
      uuid: 'item-1', name: 'Oats', portion: 40, unit: 'g', quantity: 1, category: 'Cereal',
      nutrition: { calories: 150, proteins: 5, carbohydrates: 27, fat: 3, fiber: 4, sugars: 1, sodium: 2 },
      imgUrl: 'data:image/png;base64,CCCC',
    },
    {
      uuid: 'item-2', name: 'Split bowl', portion: 1, unit: 'serving', quantity: 1,
      _splitItems: [
        { uuid: 'split-1', name: 'Rice', portion: 100, unit: 'g', quantity: 1,
          nutrition: { calories: 200, proteins: 4, carbohydrates: 44, fat: 1 } },
        { uuid: 'split-2', name: 'Apple', portion: 1, unit: 'piece', quantity: 1,
          nutrition: { calories: 52, proteins: 0, carbohydrates: 14, fat: 0 } },
      ],
    },
  ];
  const addDay = (date, items, water) => db.prepare(
    `INSERT INTO diary (user_id, date, items, body_stats, water, notes, completed_meals)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(target, date, JSON.stringify(items), JSON.stringify({ weight_kg: 70, body_fat: 20 }),
    JSON.stringify(water), 'day note', JSON.stringify([0, 2]));
  // Legacy flat item: no nested nutrition, hyphenated nutrient ids.
  const flatItem = {
    uuid: 'item-flat', name: 'Legacy flat', portion: 100, unit: 'g', quantity: 1,
    calories: 120, 'vitamin-a': 30, 'saturated-fat': 2,
  };
  addDay(DAY1, dayItems, [{ uuid: 'w1', amount: 250 }]);
  addDay(DAY2, dayItems, [{ uuid: 'w2', amount: 500 }]);
  addDay(DAY3, [...dayItems, flatItem], []);

  // String-stored macros must come back numeric from foods/meals.
  mkFood(regular, 'String food', {
    nutrition: { calories: '150', proteins: '5', carbohydrates: '20', fat: '2' },
  });
  db.prepare(
    `INSERT INTO meals (user_id, name, nutrition, items, img_url, notes, is_recipe, portion, unit, servings)
     VALUES (?, ?, ?, ?, ?, ?, 0, 100, 'g', 1)`
  ).run(regular, 'String meal',
    JSON.stringify({ calories: '300', proteins: '10', carbohydrates: '40', fat: '5' }),
    JSON.stringify([]), null, null);

  // Ongoing fast (end_at null) for the regular user; far past start so the
  // computed duration is positive regardless of the real clock.
  db.prepare(
    'INSERT INTO fasts (user_id, start_at, end_at, goal_hours, notes) VALUES (?, ?, ?, ?, ?)'
  ).run(regular, '2020-01-01 00:00:00', null, 16, 'ongoing');

  // A data: avatar must never leak from the overview rows or the detail.
  db.prepare("UPDATE users SET avatar_url = 'data:image/png;base64,DDDD' WHERE id = ?").run(target);

  const addActivity = (date, name, kcal, dur) => db.prepare(
    'INSERT INTO activity_log (user_id, date, name, kcal, duration_min, distance, source, met) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(target, date, name, kcal, dur, '2 km', 'manual_form', 5.5);
  addActivity(DAY1, 'Walk', 120, 30);
  addActivity(DAY2, 'Run', 300, 25);

  const addWellness = (date, source, metric, value, meta) => db.prepare(
    'INSERT INTO wellness_data (user_id, date, source, metric_type, value, metadata) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(target, date, source, metric, value, JSON.stringify(meta));
  addWellness(DAY1, 'fitbit', 'steps', 8000, { unit: 'steps' });
  addWellness(DAY2, 'withings', 'weight_kg', 70.2, { device: 'scale' });

  db.prepare(
    'INSERT INTO fasts (user_id, start_at, end_at, goal_hours, notes) VALUES (?, ?, ?, ?, ?)'
  ).run(target, '2026-11-24 20:00:00', '2026-11-25 12:00:00', 16, '16:8');

  // Soft-deleted rows: every count must ignore them, exactly like the list
  // endpoints do. Without the deleted_at filter diary_days > 0 while
  // last_diary_date can be null.
  const delFood = mkFood(target, 'Deleted food', { nutrition: { calories: 1 } });
  db.prepare("UPDATE foods SET deleted_at = datetime('now') WHERE id = ?").run(delFood);
  addDay('2026-11-19', dayItems, []);
  db.prepare("UPDATE diary SET deleted_at = datetime('now') WHERE user_id = ? AND date = ?").run(target, '2026-11-19');
  const delAct = addActivity('2026-11-19', 'Deleted walk', 50, 10);
  db.prepare("UPDATE activity_log SET deleted_at = datetime('now') WHERE id = ?").run(delAct.lastInsertRowid);
  const delFast = db.prepare(
    'INSERT INTO fasts (user_id, start_at, end_at, goal_hours, notes) VALUES (?, ?, ?, ?, ?)'
  ).run(target, '2026-11-18 20:00:00', '2026-11-19 12:00:00', 16, 'deleted');
  db.prepare("UPDATE fasts SET deleted_at = datetime('now') WHERE id = ?").run(delFast.lastInsertRowid);

  const insertCapFood = db.prepare(
    `INSERT INTO foods (user_id, name, nutrition, portion, unit) VALUES (?, ?, '{}', 100, 'g')`
  );
  const insertCapMeal = db.prepare(
    `INSERT INTO meals (user_id, name, nutrition, items, is_recipe, portion, unit, servings)
     VALUES (?, ?, '{}', '[]', 0, 100, 'g', 1)`
  );
  const insertCapActivity = db.prepare(
    'INSERT INTO activity_log (user_id, date, name, kcal, duration_min, distance, source, met) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertCapWellness = db.prepare(
    'INSERT INTO wellness_data (user_id, date, source, metric_type, value, metadata) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertCapFast = db.prepare(
    'INSERT INTO fasts (user_id, start_at, end_at, goal_hours, notes) VALUES (?, ?, ?, ?, ?)'
  );
  db.transaction(() => {
    for (let i = 0; i < LIMITS.foods + 1; i++) insertCapFood.run(capUser, `Cap food ${i}`);
    for (let i = 0; i < LIMITS.meals + 1; i++) insertCapMeal.run(capUser, `Cap meal ${i}`);
    for (let i = 0; i < LIMITS.activity + 1; i++) {
      insertCapActivity.run(capUser, DAY3, `Cap act ${i}`, 10, 5, null, 'manual_form', 5);
    }
    for (let i = 0; i < LIMITS.wellness + 1; i++) {
      insertCapWellness.run(capUser, DAY3, 'manual', `metric_${i}`, i, '{}');
    }
    for (let i = 0; i < LIMITS.fasts + 1; i++) {
      insertCapFast.run(capUser, '2026-11-01 20:00:00', '2026-11-02 12:00:00', 16, null);
    }
  })();

  const app = express();
  app.use(express.json());
  // What requireAuth/requireAdmin leave behind: the signed-in account, chosen per request.
  app.use((r, _res, next) => {
    const id = Number(r.headers['x-user']);
    r.user = Number.isFinite(id) ? { id, role: r.headers['x-role'] || 'admin' } : null;
    next();
  });
  app.use('/api/admin/overview', overviewRoutes);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
} catch { /* better-sqlite3 not built for this Node: the cases skip */ }

test.after(() => {
  server?.close();
  try { db?.close(); } catch {}
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const get = async (path, { user = admin, role = 'admin' } = {}) => {
  const res = await fetch(`${base}${path}`, { headers: { 'x-user': String(user), 'x-role': role } });
  return { status: res.status, body: await res.json() };
};
const forbiddenKeys = /password_hash|token|api_key|secret|^hash$/i;
function walkKeys(value, fn, path = '') {
  if (Array.isArray(value)) return value.forEach((v, i) => walkKeys(v, fn, `${path}[${i}]`));
  if (!value || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    fn(k, path);
    walkKeys(v, fn, path ? `${path}.${k}` : k);
  }
}

test('non-admin gets 403', async (t) => {
  if (!db) return t.skip('better-sqlite3 is not built for this Node');
  const r = await get('/api/admin/overview', { user: regular, role: 'user' });
  assert.equal(r.status, 403);
});

test('non-admin gets 403 on subroutes too', async (t) => {
  if (!db) return t.skip('better-sqlite3 is not built for this Node');
  const r = await get(`/api/admin/overview/users/${target}/diary`, { user: regular, role: 'user' });
  assert.equal(r.status, 403);
});

test('admin overview lists users with useful counts', async (t) => {
  if (!db) return t.skip('better-sqlite3 is not built for this Node');
  const r = await get('/api/admin/overview');
  assert.equal(r.status, 200);
  assert.equal(r.body.totals.users, 4);
  const row = r.body.users.find(u => u.id === target);
  assert.ok(row, 'target user listed');
  assert.equal(row.username, 'target');
  assert.equal(row.role, 'user');
  assert.equal(row.diary_days, 3);
  assert.equal(row.last_diary_date, DAY3);
  assert.equal(row.foods, 3);
  assert.equal(row.meals, 1);
  assert.equal(row.recipes, 1);
  assert.equal(row.activities, 2);
  assert.equal(row.workouts, 0);
  assert.equal(row.fasts, 1);
  assert.equal(row.wellness_records, 2);
  assert.equal(row.avatar_url, null, 'data: avatars are dropped');
  assert.equal(r.body.totals.diary_days, r.body.users.reduce((s, u) => s + u.diary_days, 0));
  assert.equal(r.body.totals.foods, r.body.users.reduce((s, u) => s + u.foods, 0));
  assert.equal(r.body.totals.fasts, r.body.users.reduce((s, u) => s + u.fasts, 0));
  assert.equal(r.body.totals.wellness_records, r.body.users.reduce((s, u) => s + u.wellness_records, 0));
});

test('soft-deleted rows are excluded from overview and detail counts', async (t) => {
  if (!db) return t.skip('better-sqlite3 is not built for this Node');
  const live = {
    diary_days: 3, foods: 3, meals: 1, recipes: 1, activities: 2, fasts: 1,
  };
  const deleted = {
    diary: db.prepare('SELECT COUNT(*) c FROM diary WHERE user_id = ? AND deleted_at IS NOT NULL').get(target).c,
    foods: db.prepare('SELECT COUNT(*) c FROM foods WHERE user_id = ? AND deleted_at IS NOT NULL').get(target).c,
    activities: db.prepare('SELECT COUNT(*) c FROM activity_log WHERE user_id = ? AND deleted_at IS NOT NULL').get(target).c,
    fasts: db.prepare('SELECT COUNT(*) c FROM fasts WHERE user_id = ? AND deleted_at IS NOT NULL').get(target).c,
  };
  assert.deepEqual(deleted, { diary: 1, foods: 1, activities: 1, fasts: 1 }, 'soft-deleted fixtures exist');

  const list = await get('/api/admin/overview');
  assert.equal(list.status, 200);
  const row = list.body.users.find(u => u.id === target);
  for (const [k, v] of Object.entries(live)) assert.equal(row[k], v, `overview ${k}`);
  assert.equal(row.last_diary_date, DAY3);
  assert.notEqual(row.last_diary_date, '2026-11-19');

  const detail = await get(`/api/admin/overview/users/${target}`);
  assert.equal(detail.status, 200);
  for (const [k, v] of Object.entries(live)) assert.equal(detail.body.counts[k], v, `detail ${k}`);
  assert.equal(detail.body.counts.last_diary_date, DAY3);
  assert.equal(detail.body.recent_days.length, 3);
});

test('user detail has profile, counts and numeric recent days', async (t) => {
  if (!db) return t.skip('better-sqlite3 is not built for this Node');
  const r = await get(`/api/admin/overview/users/${target}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.id, target);
  assert.equal(r.body.avatar_url, null, 'data: avatars are dropped from detail');
  assert.equal(r.body.has_password, true);
  assert.equal(r.body.counts.diary_days, 3);
  assert.ok(Array.isArray(r.body.recent_days));
  assert.equal(r.body.recent_days.length, 3);
  for (const d of r.body.recent_days) {
    assert.equal(typeof d.date, 'string');
    assert.equal(typeof d.item_count, 'number');
    assert.equal(typeof d.kcal, 'number');
    assert.equal(typeof d.water_ml, 'number');
  }
  assert.ok(r.body.recent_days.some(d => d.kcal > 0));
});

test('diary returns parsed items and server-computed totals', async (t) => {
  if (!db) return t.skip('better-sqlite3 is not built for this Node');
  const r = await get(`/api/admin/overview/users/${target}/diary?from=2026-11-01&to=2026-11-30`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
  assert.equal(r.body.length, 3);
  for (const day of r.body) {
    assert.equal(typeof day.date, 'string');
    assert.equal(typeof day.notes, 'string');
    assert.ok(Array.isArray(day.completed_meals));
    assert.ok(day.body_stats && typeof day.body_stats === 'object' && !Array.isArray(day.body_stats));
    assert.ok(Array.isArray(day.water));
    assert.ok(day.totals && typeof day.totals === 'object');
    assert.equal(typeof day.totals.kcal, 'number');
    assert.equal(typeof day.totals.protein, 'number');
    assert.equal(typeof day.totals.carbs, 'number');
    assert.equal(typeof day.totals.fat, 'number');
    assert.equal(typeof day.totals.fiber, 'number');
    assert.equal(typeof day.totals.sugar, 'number');
    assert.equal(typeof day.totals.sodium, 'number');
    assert.equal(typeof day.totals.water_ml, 'number');
    assert.equal(typeof day.totals.item_count, 'number');
    assert.ok(day.totals.kcal > 0, 'totals.kcal must reflect item calories');
    assert.ok(Array.isArray(day.items));
    for (const it of day.items) {
      assert.ok(it.nutrition && typeof it.nutrition === 'object' && !Array.isArray(it.nutrition));
      assert.equal(typeof it.nutrition.calories, 'number');
      assert.equal(typeof it.name, 'string');
      assert.equal(typeof it.portion, 'number');
      assert.equal(typeof it.unit, 'string');
      assert.equal(typeof it.quantity, 'number');
    }
    assert.ok(!JSON.stringify(day).includes('data:'));
  }
  assert.equal(r.body[0].totals.water_ml, 250);
  assert.equal(r.body[0].body_stats.weight_kg, 70);
});

test('flat legacy items keep hyphenated nutrients and feed totals', async (t) => {
  if (!db) return t.skip('better-sqlite3 is not built for this Node');
  const r = await get(`/api/admin/overview/users/${target}/diary?from=2026-11-01&to=2026-11-30`);
  assert.equal(r.status, 200);
  const day = r.body.find(d => d.date === DAY3);
  assert.ok(day);
  const flat = day.items.find(i => i.name === 'Legacy flat');
  assert.ok(flat, 'flat item present');
  assert.equal(flat.nutrition.calories, 120);
  assert.equal(flat.nutrition['vitamin-a'], 30);
  assert.equal(flat.nutrition['saturated-fat'], 2);
  // 150 (Oats) + 200 + 52 (split) + 120 (flat) calories.
  assert.equal(day.totals.kcal, 522, 'flat item calories feed totals');
});

test('foods returns parsed nutrition, alt_units and a capped envelope', async (t) => {
  if (!db) return t.skip('better-sqlite3 is not built for this Node');
  const r = await get(`/api/admin/overview/users/${target}/foods`);
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 3);
  assert.equal(r.body.truncated, false);
  assert.equal(r.body.rows.length, 3);
  const oats = r.body.rows.find(f => f.name === 'Oats');
  assert.ok(oats);
  assert.equal(oats.nutrition.calories, 150);
  assert.ok(Array.isArray(oats.alt_units));
  assert.equal(oats.alt_units[0].abbr, 'cup');
  assert.equal(oats.nutrition_basis, 'g');
  const rice = r.body.rows.find(f => f.name === 'Rice');
  assert.equal(rice.img_url, null, 'data: image URLs are dropped');

  const capped = await get(`/api/admin/overview/users/${capUser}/foods`);
  assert.equal(capped.status, 200);
  assert.equal(capped.body.rows.length, LIMITS.foods);
  assert.equal(capped.body.total, LIMITS.foods + 1);
  assert.equal(capped.body.truncated, true);
});

test('string-stored macros come back numeric from foods and meals', async (t) => {
  if (!db) return t.skip('better-sqlite3 is not built for this Node');
  const foods = await get(`/api/admin/overview/users/${regular}/foods`);
  assert.equal(foods.status, 200);
  const food = foods.body.rows.find(f => f.name === 'String food');
  assert.ok(food);
  assert.equal(typeof food.nutrition.calories, 'number');
  assert.equal(food.nutrition.calories, 150);
  assert.equal(typeof food.nutrition.proteins, 'number');

  const meals = await get(`/api/admin/overview/users/${regular}/meals`);
  assert.equal(meals.status, 200);
  const meal = meals.body.rows.find(m => m.name === 'String meal');
  assert.ok(meal);
  assert.equal(typeof meal.nutrition.calories, 'number');
  assert.equal(meal.nutrition.calories, 300);
  assert.equal(typeof meal.nutrition.proteins, 'number');
});

test('meals returns parsed items plus resolved ingredients', async (t) => {
  if (!db) return t.skip('better-sqlite3 is not built for this Node');
  const r = await get(`/api/admin/overview/users/${target}/meals`);
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 2);
  assert.equal(r.body.truncated, false);
  const bowl = r.body.rows.find(m => m.id === mealId);
  assert.ok(bowl);
  assert.equal(bowl.is_recipe, false);
  assert.ok(Array.isArray(bowl.items));
  assert.equal(bowl.items.length, 2);
  assert.ok(Array.isArray(bowl.ingredients));
  assert.deepEqual(bowl.ingredients[0], { name: 'Oats', portion: 40, unit: 'g' });
  assert.equal(typeof bowl.nutrition.calories, 'number');
  assert.equal(bowl.items[0].imgUrl, null, 'nested meal item data: images are dropped');
  assert.ok(!JSON.stringify(r.body).includes('data:'), 'meal items must not leak data: URLs');
  const recipe = r.body.rows.find(m => m.id === recipeId);
  assert.equal(recipe.is_recipe, true);
  assert.equal(recipe.img_url, null);
});

test('activity, wellness and fasts return detailed rows', async (t) => {
  if (!db) return t.skip('better-sqlite3 is not built for this Node');
  const act = await get(`/api/admin/overview/users/${target}/activity?from=2026-11-01&to=2026-11-30`);
  assert.equal(act.status, 200);
  assert.equal(act.body.total, 2);
  assert.equal(act.body.truncated, false);
  assert.equal(act.body.rows.length, 2);
  for (const a of act.body.rows) {
    assert.equal(typeof a.date, 'string');
    assert.equal(typeof a.name, 'string');
    assert.equal(typeof a.kcal, 'number');
    assert.equal(typeof a.duration_min, 'number');
    assert.equal(typeof a.source, 'string');
  }

  const wel = await get(`/api/admin/overview/users/${target}/wellness?from=2026-11-01&to=2026-11-30`);
  assert.equal(wel.status, 200);
  assert.equal(wel.body.total, 2);
  assert.equal(wel.body.rows.length, 2);
  for (const w of wel.body.rows) {
    assert.equal(typeof w.date, 'string');
    assert.equal(typeof w.source, 'string');
    assert.equal(typeof w.metric_type, 'string');
    assert.equal(typeof w.value, 'number');
    assert.ok(w.metadata && typeof w.metadata === 'object' && !Array.isArray(w.metadata));
  }

  const fasts = await get(`/api/admin/overview/users/${target}/fasts`);
  assert.equal(fasts.status, 200);
  assert.equal(fasts.body.total, 1);
  assert.equal(fasts.body.truncated, false);
  const fast = fasts.body.rows[0];
  assert.equal(typeof fast.start_at, 'string');
  assert.equal(typeof fast.end_at, 'string');
  assert.equal(fast.goal_hours, 16);
  assert.equal(fast.duration_hours, 16);
});

test('ongoing fast computes a positive duration from the current clock', async (t) => {
  if (!db) return t.skip('better-sqlite3 is not built for this Node');
  const r = await get(`/api/admin/overview/users/${regular}/fasts`);
  assert.equal(r.status, 200);
  const fast = r.body.rows.find(f => f.end_at === null);
  assert.ok(fast, 'active fast listed');
  assert.equal(typeof fast.duration_hours, 'number');
  assert.ok(fast.duration_hours > 0, 'duration_hours must be positive while running');
});

test('meals, activity, wellness and fasts are capped like foods', async (t) => {
  if (!db) return t.skip('better-sqlite3 is not built for this Node');
  const cases = [
    [`/api/admin/overview/users/${capUser}/meals`, LIMITS.meals],
    [`/api/admin/overview/users/${capUser}/activity?from=2026-11-01&to=2026-11-30`, LIMITS.activity],
    [`/api/admin/overview/users/${capUser}/wellness?from=2026-11-01&to=2026-11-30`, LIMITS.wellness],
    [`/api/admin/overview/users/${capUser}/fasts`, LIMITS.fasts],
  ];
  for (const [path, limit] of cases) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
    assert.equal(r.body.rows.length, limit, `${path} row cap`);
    assert.equal(r.body.total, limit + 1, `${path} total`);
    assert.equal(r.body.truncated, true, `${path} truncated`);
  }
});

test('missing user is 404', async (t) => {
  if (!db) return t.skip('better-sqlite3 is not built for this Node');
  const r = await get('/api/admin/overview/users/999999');
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'User not found');
});

test('bad dates and oversized ranges are 400', async (t) => {
  if (!db) return t.skip('better-sqlite3 is not built for this Node');
  const bad = await get(`/api/admin/overview/users/${target}/diary?from=bad&to=2026-11-30`);
  assert.equal(bad.status, 400);
  const huge = await get(`/api/admin/overview/users/${target}/diary?from=2020-01-01&to=2026-11-30`);
  assert.equal(huge.status, 400);
  assert.equal(huge.body.error, 'Range too large');
  const actBad = await get(`/api/admin/overview/users/${target}/activity?from=2026-13-01&to=2026-11-30`);
  assert.equal(actBad.status, 400);
});

test('no secret or data: image leaks anywhere in responses', async (t) => {
  if (!db) return t.skip('better-sqlite3 is not built for this Node');
  const paths = [
    '/api/admin/overview',
    `/api/admin/overview/users/${target}`,
    `/api/admin/overview/users/${target}/diary?from=2026-11-01&to=2026-11-30`,
    `/api/admin/overview/users/${target}/foods`,
    `/api/admin/overview/users/${target}/meals`,
    `/api/admin/overview/users/${target}/activity?from=2026-11-01&to=2026-11-30`,
    `/api/admin/overview/users/${target}/wellness?from=2026-11-01&to=2026-11-30`,
    `/api/admin/overview/users/${target}/fasts`,
  ];
  for (const path of paths) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
    walkKeys(r.body, (key, at) => {
      assert.ok(!forbiddenKeys.test(key), `forbidden key "${key}" at ${at || path}`);
    });
    assert.ok(!JSON.stringify(r.body).includes('data:'), `data: URL leaked from ${path}`);
  }
});

test('single-user mode is 403 for every endpoint', async (t) => {
  if (!db) return t.skip('better-sqlite3 is not built for this Node');
  db.prepare('DELETE FROM users').run();
  for (const path of [
    '/api/admin/overview',
    `/api/admin/overview/users/${target}`,
    `/api/admin/overview/users/${target}/diary`,
    `/api/admin/overview/users/${target}/foods`,
    `/api/admin/overview/users/${target}/meals`,
    `/api/admin/overview/users/${target}/activity`,
    `/api/admin/overview/users/${target}/wellness`,
    `/api/admin/overview/users/${target}/fasts`,
  ]) {
    const r = await get(path);
    assert.equal(r.status, 403, path);
    assert.equal(r.body.error, 'User management is off');
  }
});
