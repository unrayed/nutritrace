# Admin Overview — verification bar

Purpose: prove the admin view returns **useful, detailed data**, not ids, raw JSON blobs, or empty shells. Every verifier must check this table, not just status codes.

## Detail contract

### `GET /api/admin/overview`
Per user row MUST include:
`id, username, full_name, nickname, avatar_url, role, created_at, diary_days, last_diary_date, foods, meals, recipes, activities, workouts, fasts, wellness_points`
`totals` MUST sum the same categories across users.

### `GET /api/admin/overview/users/:id`
MUST include profile (no `password_hash`), `counts`, and `recent_days[]` where each day is:
`{ date, item_count, kcal, water_ml }` (numbers, not strings).

### `GET /api/admin/overview/users/:id/diary`
Each day MUST include:
- `date`, `notes`, `completed_meals`
- `items[]`: each item carries `name`, `portion`, `unit`, `quantity`, `category` (when present), `nutrition` object with numeric `calories`, `proteins`, `carbohydrates`, `fat` and any other stored keys (`fiber`, `sugars`, `sodium`), `uuid`
- `body_stats` parsed object (weight/body-fat/etc. keys as stored)
- `water[]` parsed
- `totals`: `{ kcal, protein, carbs, fat, fiber, sugar, sodium, water_ml, item_count }` computed server-side
- **No raw JSON strings** anywhere (`nutrition` must be an object, not `"{}"` text).
- **No `data:` image URLs**: `img_url`/`imgUrl` beginning `data:` → `null`.

### `GET /api/admin/overview/users/:id/foods`
Each row: `id, name, brand, category, barcode, portion, unit, nutrition` (parsed object with numeric macros), `alt_units` parsed array or null, `nutrition_basis`, `notes`, `created_at`, `img_url` (no data URLs).
Capped list MUST return `{ rows, total, truncated }`, not silently drop.

### `GET /api/admin/overview/users/:id/meals`
Each row: `id, name, is_recipe, servings, portion, unit, nutrition` parsed, `items[]` parsed, `ingredients[]` with resolvable `{ name, portion, unit }` (or `null` when the referenced food is gone), `created_at`, `img_url` (no data URLs). Same `{ rows, total, truncated }` envelope.

### `GET /api/admin/overview/users/:id/activity`
Each row: `id, date, name, kcal, duration_min, distance, source, met`. Range-validated, cap + `truncated`.

### `GET /api/admin/overview/users/:id/wellness`
Each row: `id, date, source, metric_type, value, metadata` parsed object. Range-validated, cap + `truncated`.

### `GET /api/admin/overview/users/:id/fasts`
Each row: `id, start_at, end_at, goal_hours, duration_hours` computed, `notes`. Cap + `truncated`.

## Required verification method (backend)

1. Boot a temp DB (`DB_PATH` in a fresh tmp dir) and seed a **realistic** second user:
   - 3 diary days with 2+ items each (one with `_splitItems`), non-zero macros, water, body_stats, notes
   - 3 foods with full nutrition + one `alt_units` array + one `data:` image
   - 1 meal and 1 recipe with items referencing those foods
   - 2 activity rows, 2 wellness rows (different sources), 1 fast
2. Call every endpoint as an admin and **assert field presence and types** (not just 200). A day whose `totals.kcal === 0` while items have calories is a failure.
3. Assert the serialized JSON contains none of: `password_hash`, `token`, `api_key`, `secret`, `data:image`.
4. Assert non-member admin **does** see the seeded data (that is the feature).
5. Assert non-admin gets 403.
6. Assert `truncated: true` + `total` when seeded rows exceed the cap (or verify the cap constant is honoured).

## Required verification method (frontend)

- `npm run build` and `npm run i18n:check` pass.
- Component renders every tab with seeded API responses: diary shows macros and per-item portion/unit/qty; meals show ingredients; activity shows duration; wellness shows metric+value; fasts show computed duration.
- Loading, empty, error+retry, and access-denied states all reachable.
- No raw JSON, no `[object Object]`, no `undefined`/`NaN` visible.
- Responsive 390px: no page-level horizontal scroll.

## Verdict format

For each row above: `PASS` / `FAIL <evidence>` / `NOT IMPLEMENTED`. Any `FAIL` or `NOT IMPLEMENTED` becomes a fix-lane task with the exact missing field and file/line.
