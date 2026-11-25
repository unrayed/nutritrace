import { Router } from 'express';
import db from '../db.js';
import { wrap } from '../logger.js';
import { requireAuth, requireAdmin, userMgmtActive } from '../middleware/auth.js';
import { freshenItemImages, hydrateItems } from '../lib/diary-helpers.js';
import { Nutrition, NUTRIMENTS } from '../../src/lib/nutrition.js';

const router = Router();

export const LIMITS = { foods: 500, meals: 500, activity: 500, wellness: 500, fasts: 200, recent_days: 30 };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Canonical ids are hyphenated (see src/lib/nutrition.js NUTRIMENTS). Legacy
// flat items store those same ids plus the old calories_kcal alias.
const FLAT_NUTRIENTS = [...NUTRIMENTS.map(n => n.id), 'calories_kcal'];

function safeJson(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v == null ? fallback : v;
  } catch { return fallback; }
}

function coerceNutrition(src) {
  const out = {};
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  for (const [k, v] of Object.entries(src)) {
    if (k === '_derived') continue;
    const n = Number(v);
    out[k] = v != null && v !== '' && Number.isFinite(n) ? n : v;
  }
  return out;
}

function itemNutrition(item) {
  const nested = item?.nutrition;
  if (nested && typeof nested === 'object' && !Array.isArray(nested) && Object.keys(nested).length) {
    return coerceNutrition(nested);
  }
  const out = {};
  for (const k of FLAT_NUTRIENTS) {
    if (item?.[k] == null || item[k] === '') continue;
    const key = k === 'calories_kcal' ? 'calories' : k;
    const n = Number(item[k]);
    if (Number.isFinite(n)) out[key] = n;
  }
  if (Object.keys(out).length) return out;
  // Split-recipe parents carry their macros only on _splitItems. Derive the
  // displayed nutrition from the same calculate() the totals use.
  return coerceNutrition(Nutrition.calculate(item));
}

function cleanImage(v) {
  return typeof v === 'string' && v.startsWith('data:') ? null : (v ?? null);
}

function cleanItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const out = { ...item, nutrition: itemNutrition(item) };
  if ('imgUrl' in out) out.imgUrl = cleanImage(out.imgUrl);
  if ('img_url' in out) out.img_url = cleanImage(out.img_url);
  if (Array.isArray(out._splitItems)) out._splitItems = out._splitItems.map(cleanItem);
  return out;
}

function parseCompletedMeals(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(n => Number.isInteger(n) && n >= 0 && n <= 31);
  } catch { return []; }
}

function round1(v) {
  return Math.round((Number(v) || 0) * 10) / 10;
}

function dayTotals(items, water) {
  const sum = Nutrition.sum(Array.isArray(items) ? items.map(i => Nutrition.calculate(i)) : []);
  const logs = Array.isArray(water) ? water : [];
  return {
    kcal: round1(sum.calories),
    protein: round1(sum.proteins),
    carbs: round1(sum.carbohydrates),
    fat: round1(sum.fat),
    fiber: round1(sum.fiber),
    sugar: round1(sum.sugars),
    sodium: round1(sum.sodium),
    water_ml: logs.reduce((s, l) => s + (Number(l?.amount) || 0), 0),
    item_count: Array.isArray(items) ? items.length : 0,
  };
}

function parseDiaryRow(row, userId) {
  const rawItems = safeJson(row.items, []);
  const items = freshenItemImages(hydrateItems(rawItems, userId), userId).map(cleanItem);
  const bodyStats = safeJson(row.body_stats, {});
  const water = safeJson(row.water, []);
  return {
    date: row.date,
    items,
    body_stats: bodyStats && typeof bodyStats === 'object' && !Array.isArray(bodyStats) ? bodyStats : {},
    water: Array.isArray(water) ? water : [],
    notes: row.notes || '',
    completed_meals: parseCompletedMeals(row.completed_meals),
    updated_at: row.updated_at ?? null,
    totals: dayTotals(items, water),
  };
}

function isCalendarDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function defaultRange() {
  const now = new Date();
  const to = now.toLocaleDateString('sv-SE');
  const start = new Date(now);
  start.setDate(start.getDate() - 6);
  return { from: start.toLocaleDateString('sv-SE'), to };
}

function parseRange(query) {
  const def = defaultRange();
  const from = typeof query.from === 'string' && query.from ? query.from : def.from;
  const to = typeof query.to === 'string' && query.to ? query.to : def.to;
  if (!isCalendarDate(from) || !isCalendarDate(to)) {
    return { error: 'Invalid date; expected YYYY-MM-DD' };
  }
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const f = Date.UTC(fy, fm - 1, fd);
  const t = Date.UTC(ty, tm - 1, td);
  if (f > t) return { error: 'Invalid date range' };
  if ((t - f) / 86_400_000 + 1 > 366) return { error: 'Range too large' };
  return { from, to };
}

function _count(sql, ...params) {
  try { return db.prepare(sql).get(...params)?.c ?? 0; }
  catch { return 0; }
}

function lastDiaryDate(userId) {
  try {
    return db.prepare('SELECT MAX(date) d FROM diary WHERE user_id = ? AND deleted_at IS NULL').get(userId)?.d ?? null;
  } catch { return null; }
}

function userCounts(id) {
  return {
    diary_days: _count('SELECT COUNT(*) c FROM diary WHERE user_id = ? AND deleted_at IS NULL', id),
    last_diary_date: lastDiaryDate(id),
    foods: _count('SELECT COUNT(*) c FROM foods WHERE user_id = ? AND deleted_at IS NULL', id),
    meals: _count('SELECT COUNT(*) c FROM meals WHERE user_id = ? AND is_recipe = 0 AND deleted_at IS NULL', id),
    recipes: _count('SELECT COUNT(*) c FROM meals WHERE user_id = ? AND is_recipe = 1 AND deleted_at IS NULL', id),
    activities: _count('SELECT COUNT(*) c FROM activity_log WHERE user_id = ? AND deleted_at IS NULL', id),
    workouts: _count('SELECT COUNT(*) c FROM workouts WHERE user_id = ?', id),
    fasts: _count('SELECT COUNT(*) c FROM fasts WHERE user_id = ? AND deleted_at IS NULL', id),
    wellness_records: _count('SELECT COUNT(*) c FROM wellness_data WHERE user_id = ?', id),
  };
}

function findUser(id) {
  return db.prepare('SELECT id FROM users WHERE id = ?').get(id);
}

function recentDays(userId) {
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT date, items, water FROM diary
        WHERE user_id = ? AND deleted_at IS NULL
        ORDER BY date DESC LIMIT ?`
    ).all(userId, LIMITS.recent_days);
  } catch { return []; }
  return rows.map(r => {
    const items = safeJson(r.items, []);
    const water = safeJson(r.water, []);
    const sum = Nutrition.sum(Array.isArray(items) ? items.map(i => Nutrition.calculate(i)) : []);
    const logs = Array.isArray(water) ? water : [];
    return {
      date: r.date,
      item_count: Array.isArray(items) ? items.length : 0,
      kcal: round1(sum.calories),
      water_ml: logs.reduce((s, l) => s + (Number(l?.amount) || 0), 0),
    };
  });
}

// Single-user mode disables the whole feature, even though requireAuth /
// requireAdmin pass through in that mode.
router.use((req, res, next) => {
  if (!userMgmtActive()) return res.status(403).json({ error: 'User management is off' });
  next();
});
router.use(requireAuth, requireAdmin);

router.get('/', wrap((req, res) => {
  const users = db.prepare(
    'SELECT id, username, full_name, nickname, avatar_url, role, created_at FROM users ORDER BY created_at'
  ).all();
  const rows = users.map(u => ({ ...u, avatar_url: cleanImage(u.avatar_url), ...userCounts(u.id) }));
  const totals = {
    users: rows.length,
    diary_days: rows.reduce((s, u) => s + u.diary_days, 0),
    foods: rows.reduce((s, u) => s + u.foods, 0),
    meals: rows.reduce((s, u) => s + u.meals, 0),
    recipes: rows.reduce((s, u) => s + u.recipes, 0),
    activities: rows.reduce((s, u) => s + u.activities, 0),
    workouts: rows.reduce((s, u) => s + u.workouts, 0),
    fasts: rows.reduce((s, u) => s + u.fasts, 0),
    wellness_records: rows.reduce((s, u) => s + u.wellness_records, 0),
  };
  res.json({ totals, users: rows });
}));

router.get('/users/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'User not found' });
  const user = db.prepare(
    `SELECT id, username, full_name, nickname, birthday, gender, avatar_url, role, created_at,
            CASE WHEN password_hash IS NOT NULL AND password_hash != '' THEN 1 ELSE 0 END AS has_password
       FROM users WHERE id = ?`
  ).get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    ...user,
    avatar_url: cleanImage(user.avatar_url),
    has_password: !!user.has_password,
    counts: userCounts(id),
    recent_days: recentDays(id),
  });
}));

router.get('/users/:id/diary', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'User not found' });
  if (!findUser(id)) return res.status(404).json({ error: 'User not found' });
  const range = parseRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error });
  const rows = db.prepare(
    `SELECT * FROM diary
      WHERE user_id = ? AND deleted_at IS NULL AND date BETWEEN ? AND ?
      ORDER BY date ASC`
  ).all(id, range.from, range.to);
  res.json(rows.map(r => parseDiaryRow(r, id)));
}));

router.get('/users/:id/foods', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'User not found' });
  if (!findUser(id)) return res.status(404).json({ error: 'User not found' });
  const total = _count('SELECT COUNT(*) c FROM foods WHERE user_id = ? AND deleted_at IS NULL', id);
  const rows = db.prepare(
    `SELECT id, name, brand, category, barcode, portion, unit, nutrition, img_url, notes,
            created_at, nutrition_basis, alt_units
       FROM foods WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY name LIMIT ?`
  ).all(id, LIMITS.foods).map(r => {
    const alt = safeJson(r.alt_units, null);
    return {
      ...r,
      nutrition: coerceNutrition(safeJson(r.nutrition, {})),
      alt_units: Array.isArray(alt) ? alt : null,
      img_url: cleanImage(r.img_url),
    };
  });
  res.json({ rows, total, truncated: total > rows.length });
}));

router.get('/users/:id/meals', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'User not found' });
  if (!findUser(id)) return res.status(404).json({ error: 'User not found' });
  const total = _count('SELECT COUNT(*) c FROM meals WHERE user_id = ? AND deleted_at IS NULL', id);
  const rows = db.prepare(
    `SELECT id, name, nutrition, items, img_url, notes, is_recipe, portion, unit, servings, created_at
       FROM meals WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY name LIMIT ?`
  ).all(id, LIMITS.meals).map(r => {
    const items = safeJson(r.items, []);
    const itemArr = Array.isArray(items) ? items : [];
    const refIds = new Set();
    for (const it of itemArr) {
      const ref = it?.food_server_id === null ? null : (it?.food_server_id ?? it?.id);
      if (typeof ref === 'number') refIds.add(ref);
    }
    let byId = new Map();
    if (refIds.size) {
      try {
        const foods = db.prepare(
          `SELECT id, name, portion, unit FROM foods
            WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))`
        ).all(JSON.stringify(Array.from(refIds)));
        byId = new Map(foods.map(f => [f.id, f]));
      } catch { /* old deploy — ingredients stay null */ }
    }
    const ingredients = itemArr.map(it => {
      const ref = it?.food_server_id === null ? null : (it?.food_server_id ?? it?.id);
      const f = typeof ref === 'number' ? byId.get(ref) : null;
      return f ? { name: f.name, portion: f.portion, unit: f.unit } : null;
    });
    return {
      ...r,
      nutrition: coerceNutrition(safeJson(r.nutrition, {})),
      items: itemArr.map(cleanItem),
      ingredients,
      is_recipe: !!r.is_recipe,
      img_url: cleanImage(r.img_url),
    };
  });
  res.json({ rows, total, truncated: total > rows.length });
}));

router.get('/users/:id/activity', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'User not found' });
  if (!findUser(id)) return res.status(404).json({ error: 'User not found' });
  const range = parseRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error });
  const total = _count(
    'SELECT COUNT(*) c FROM activity_log WHERE user_id = ? AND deleted_at IS NULL AND date BETWEEN ? AND ?',
    id, range.from, range.to
  );
  const rows = db.prepare(
    `SELECT id, date, name, kcal, duration_min, distance, source, met
       FROM activity_log
      WHERE user_id = ? AND deleted_at IS NULL AND date BETWEEN ? AND ?
      ORDER BY date DESC, id DESC LIMIT ?`
  ).all(id, range.from, range.to, LIMITS.activity).map(r => ({
    ...r,
    kcal: Number(r.kcal) || 0,
    duration_min: r.duration_min == null ? null : Number(r.duration_min),
    met: r.met == null ? null : Number(r.met),
  }));
  res.json({ rows, total, truncated: total > rows.length });
}));

router.get('/users/:id/wellness', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'User not found' });
  if (!findUser(id)) return res.status(404).json({ error: 'User not found' });
  const range = parseRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error });
  const total = _count(
    'SELECT COUNT(*) c FROM wellness_data WHERE user_id = ? AND date BETWEEN ? AND ?',
    id, range.from, range.to
  );
  const rows = db.prepare(
    `SELECT id, date, source, metric_type, value, metadata
       FROM wellness_data
      WHERE user_id = ? AND date BETWEEN ? AND ?
      ORDER BY date DESC, id DESC LIMIT ?`
  ).all(id, range.from, range.to, LIMITS.wellness).map(r => ({
    ...r,
    value: r.value == null ? null : Number(r.value),
    metadata: safeJson(r.metadata, {}),
  }));
  res.json({ rows, total, truncated: total > rows.length });
}));

function durationHours(start, end) {
  const a = Date.parse(String(start).replace(' ', 'T'));
  const b = end ? Date.parse(String(end).replace(' ', 'T')) : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round(((b - a) / 3_600_000) * 10) / 10;
}

router.get('/users/:id/fasts', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'User not found' });
  if (!findUser(id)) return res.status(404).json({ error: 'User not found' });
  const total = _count('SELECT COUNT(*) c FROM fasts WHERE user_id = ? AND deleted_at IS NULL', id);
  const rows = db.prepare(
    `SELECT id, start_at, end_at, goal_hours, notes
       FROM fasts WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY start_at DESC LIMIT ?`
  ).all(id, LIMITS.fasts).map(r => ({
    ...r,
    goal_hours: r.goal_hours == null ? null : Number(r.goal_hours),
    duration_hours: durationHours(r.start_at, r.end_at),
  }));
  res.json({ rows, total, truncated: total > rows.length });
}));

export default router;
