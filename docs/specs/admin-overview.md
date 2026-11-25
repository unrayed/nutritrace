# Spec: Admin Overview (read-only instance data browser)

Branch: `feat/admin-overview` (off deployed `fix/ai-log-food-scaling`)
Repo: `/tmp/opencode/fix/nutritrace`

## Goal

An instance admin (`users.role = 'admin'`) can browse every user's NutriTrace data in one place: profile, counts, diary days, foods, meals, activity, wellness, fasts.

## Hard rules

- **Read-only.** No write/edit/delete/impersonation endpoints. Existing user management (delete user, reset password, change role) stays in `settings/users`; do not duplicate it.
- **Admin only.** `requireAuth, requireAdmin` on the whole router (`server/middleware/auth.js:81,92`).
- **Never return secrets**: no `password_hash`, `api_tokens`, `oauth_state`, `*_tokens` (fitbit/garmin/withings/google_health), `oidc_providers`, `user_oidc_links`, `password_reset_tokens`, `ai_chat_history`.
- **Single-user mode**: when `userMgmtActive()` is false (`server/middleware/auth.js:17`), return `403 { error: 'User management is off' }` for every endpoint.
- Errors: `res.status(n).json({ error: '...' })`. Wrap handlers with `wrap` from `server/logger.js:42`.
- Target user missing → `404 { error: 'User not found' }`.

## Backend — new file `server/routes/admin-overview.js`

Mount in `server/index.js` beside the other admin routers (`:230-240`):

```js
import adminOverviewRoutes from './routes/admin-overview.js';
router.use('/api/admin/overview', adminOverviewRoutes);
```

### `GET /api/admin/overview`

```json
{
  "totals": { "users": 3, "diary_days": 120, "foods": 88, "meals": 12, "recipes": 4, "activities": 40, "workouts": 7 },
  "users": [
    {
      "id": 1, "username": "ann", "full_name": "Ann", "nickname": null,
      "avatar_url": null, "role": "admin", "created_at": "...",
      "diary_days": 60, "last_diary_date": "2026-11-25",
      "foods": 40, "meals": 6, "recipes": 2, "activities": 20,
      "workouts": 3, "wellness_points": 500, "fasts": 4
    }
  ]
}
```

- List users via `SELECT id, username, full_name, nickname, avatar_url, role, created_at FROM users ORDER BY created_at`.
- Per-user counts with the `_count` guarded pattern from `server/routes/auth.js:317-338` (tables may be absent on old deploys).
- `last_diary_date` = `MAX(date)` where `deleted_at IS NULL`.

### `GET /api/admin/overview/users/:id`

Profile (safe fields, same shape as `safeUser` minus password — `server/routes/auth.js:106-113`) + the same `counts` object + `recent_days`: last 30 diary days (date, item_count, kcal, water_ml) where `deleted_at IS NULL`.

### `GET /api/admin/overview/users/:id/diary?from=YYYY-MM-DD&to=YYYY-MM-DD`

- Default range: last 7 days (server local date).
- Validate both dates match `/^\d{4}-\d{2}-\d{2}$/`; reject otherwise `400`.
- Cap range at 366 days (`400 { error: 'Range too large' }`).
- Return array of diary rows parsed like `parse()` in `server/routes/diary.js:435-460`:
  `{ date, items, body_stats, water, notes, completed_meals, updated_at }`,
  with `items` hydrated via `hydrateItems(items, userId)` and images via `freshenItemImages(items, userId)` from `server/lib/diary-helpers.js:121,163`.
- Do **not** return tombstones.

### `GET /api/admin/overview/users/:id/foods`

`SELECT id,name,brand,category,barcode,portion,unit,nutrition,img_url,notes,created_at FROM foods WHERE user_id = ? AND deleted_at IS NULL ORDER BY name`. Parse `nutrition` JSON. Cap 500 rows.

### `GET /api/admin/overview/users/:id/meals`

`SELECT id,name,nutrition,items,img_url,notes,is_recipe,portion,unit,servings,created_at FROM meals WHERE user_id = ? AND deleted_at IS NULL ORDER BY name`. Parse `nutrition`/`items`. Cap 500.

### `GET /api/admin/overview/users/:id/activity?from&to`

`activity_log` where `user_id = ? AND deleted_at IS NULL` (columns at `server/db.js` activity_log block). Same date validation/defaults.

### `GET /api/admin/overview/users/:id/wellness?from&to`

`wellness_data` where `user_id = ?` and date range; `metadata` parsed as JSON.

### `GET /api/admin/overview/users/:id/fasts`

`fasts` where `user_id = ? AND deleted_at IS NULL ORDER BY start_at DESC`, cap 200.

## Frontend — new `src/routes/settings/AdminOverview.svelte`

Read first: `src/routes/settings/Users.svelte`, `src/components/settings/SettingsUserManagement.svelte`, `src/routes/settings/Sharing.svelte`, `src/routes/Settings.svelte:226-300,640-680`, `src/stores/auth.js`, `src/stores/toast.js`, `src/i18n/en.json`.

- Data via generic `NtApi.get(path)` (`src/lib/api.js:1008-1035`); no new api*.js methods needed. On native standalone (`isNative && !getServerUrl()`), render a “server connection required” note.
- Layout: master list of users (avatar, name, role badge, counts, last diary date) + selected-user detail panel with tabs: **Diary**, **Foods**, **Meals**, **Activity**, **Wellness**, **Fasts**.
- Diary tab: date-range inputs (default last 7 days), day cards with items, portion/unit/quantity, kcal, water, notes.
- Empty/loading/error states for every tab. No edit controls.
- Show a read-only notice: “Admin view — read-only. Data belongs to the selected user.”
- Refuse to render unless `$currentUser?.role === 'admin'`; otherwise show an access-denied note.

### Settings wiring (`src/routes/Settings.svelte`)

- import `AdminOverview` near `:53`,
- `SECTION_META` near `:226-260`: `adminOverview: { titleKey: 'settings.admin_overview.section', icon: 'admin_panel_settings' }`,
- `SECTION_COMPONENTS` near `:264-292`: `adminOverview: AdminOverview`,
- `SECTION_KEYWORDS` near `:302-330`: `['admin overview','admin','instance','all users','user data','diary','foods','meals','activity','wellness','inspect']`,
- rail button inside the admin-only block near `:645-680`, guarded `{#if $currentUser?.role === 'admin'}`.

### i18n

Add `settings.admin_overview.*` + `settings.admin_overview.section` to `src/i18n/en.json`. Mirror the `section` key in `fr/de/es/ru` (missing translations only warn). Run `npm run i18n:check`.

## Tests

`scripts/admin-overview.test.js` — Pattern B (in-process Express, fake auth middleware) like `scripts/ai-history-newest.test.js:27-33`:
- non-admin → 403; admin → 200.
- overview lists users with counts.
- user detail 404 for missing id.
- diary range validation (`bad` → 400, 400-day range → 400).
- response never contains `password_hash` / `hash` / `token` keys.
- single-user mode (`userMgmtActive()` false) → 403.

Keep existing tests green (`npm test`), build green (`npm run build`), i18n check green.
