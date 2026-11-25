<script>
  import { _ } from 'svelte-i18n';
  import Spinner from '../../components/ui/Spinner.svelte';
  import { NtApi } from '../../lib/api.js';
  import { isNative, getServerUrl, resolveAssetUrl } from '../../lib/platform.js';
  import { currentUser, userMgmtActive } from '../../stores/auth.js';
  import { localDateStr } from '../../lib/db.js';

  $: isNativeLocal = isNative && !getServerUrl();
  $: isAdmin = $currentUser?.role === 'admin';

  const TABS = [
    { key: 'diary',    icon: 'menu_book',    labelKey: 'settings.admin_overview.tab_diary' },
    { key: 'foods',    icon: 'lunch_dining', labelKey: 'settings.admin_overview.tab_foods' },
    { key: 'meals',    icon: 'restaurant',   labelKey: 'settings.admin_overview.tab_meals' },
    { key: 'activity', icon: 'directions_run', labelKey: 'settings.admin_overview.tab_activity' },
    { key: 'wellness', icon: 'favorite',     labelKey: 'settings.admin_overview.tab_wellness' },
    { key: 'fasts',    icon: 'timer',        labelKey: 'settings.admin_overview.tab_fasts' },
  ];

  const EMPTY_TAB = { state: 'idle', error: '', rows: [], total: 0, truncated: false };

  let overview = null;
  let users = [];
  let listState = 'idle';
  let listError = '';

  let selectedId = null;
  let detail = null;
  let detailState = 'idle';
  let detailError = '';

  let activeTab = 'diary';
  let tabsData = {};
  let openDays = {};

  let rangeFrom = _defaultFrom();
  let rangeTo = localDateStr();
  let rangeError = '';

  let booted = false;
  let _seq = {};

  $: users = Array.isArray(overview?.users) ? overview.users : [];
  $: selectedUser = users.find(u => u.id === selectedId) || null;
  $: isRangeTab = activeTab === 'diary' || activeTab === 'activity' || activeTab === 'wellness';
  // Direct tabsData/activeTab references are required: legacy Svelte tracks
  // dependencies lexically, so a bare _tabInfo(activeTab) call would not
  // invalidate when loadTab assigns a new tabsData object.
  $: tabInfo = tabsData[activeTab] || EMPTY_TAB;
  $: tabRows = tabInfo.rows;

  $: if (!booted && isAdmin && $userMgmtActive && !isNativeLocal) {
    booted = true;
    loadOverview();
  }

  function _defaultFrom() {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return localDateStr(d);
  }

  async function loadOverview() {
    listState = 'loading';
    listError = '';
    try {
      const res = await NtApi.get('/api/admin/overview');
      overview = Array.isArray(res)
        ? { totals: {}, users: res }
        : (res && typeof res === 'object' ? res : { totals: {}, users: [] });
      listState = 'ready';
      const list = Array.isArray(overview.users) ? overview.users : [];
      if (!list.length) {
        selectedId = null;
        detail = null;
        detailState = 'idle';
        return;
      }
      const keep = list.find(u => u.id === selectedId);
      selectUser(keep || list[0]);
    } catch (e) {
      listState = 'error';
      listError = e?.message || $_('settings.admin_overview.error_load_overview');
    }
  }

  function selectUser(u) {
    if (!u) return;
    selectedId = u.id;
    detail = null;
    detailState = 'loading';
    detailError = '';
    tabsData = {};
    openDays = {};
    loadDetail();
    loadTab(activeTab);
  }

  async function loadDetail() {
    if (selectedId == null) return;
    const id = selectedId;
    detailState = 'loading';
    detailError = '';
    try {
      const res = await NtApi.get(`/api/admin/overview/users/${id}`);
      if (selectedId !== id) return;
      detail = res && typeof res === 'object' ? res : {};
      detailState = 'ready';
    } catch (e) {
      if (selectedId !== id) return;
      detailState = 'error';
      detailError = e?.message || $_('settings.admin_overview.error_load_detail');
    }
  }

  function _tabInfo(key) {
    return tabsData[key] || EMPTY_TAB;
  }

  function _tabPath(key, id) {
    const base = `/api/admin/overview/users/${id}/${key}`;
    if (key === 'diary' || key === 'activity' || key === 'wellness') {
      const qs = `?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`;
      return base + qs;
    }
    return base;
  }

  async function loadTab(key) {
    if (selectedId == null) return;
    const id = selectedId;
    const seq = (_seq[key] = (_seq[key] || 0) + 1);
    tabsData = { ...tabsData, [key]: { ..._tabInfo(key), state: 'loading', error: '' } };
    try {
      const res = await NtApi.get(_tabPath(key, id));
      if (_seq[key] !== seq || selectedId !== id) return;
      const rows = Array.isArray(res) ? res : (Array.isArray(res?.rows) ? res.rows : []);
      const total = Number.isFinite(Number(res?.total)) ? Number(res.total) : rows.length;
      tabsData = {
        ...tabsData,
        [key]: {
          state: 'ready',
          error: '',
          rows,
          total,
          truncated: res?.truncated === true,
        },
      };
    } catch (e) {
      if (_seq[key] !== seq || selectedId !== id) return;
      tabsData = {
        ...tabsData,
        [key]: { state: 'error', error: e?.message || $_('settings.admin_overview.error_load_tab'), rows: [], total: 0, truncated: false },
      };
    }
  }

  function selectTab(key) {
    if (activeTab === key && _tabInfo(key).state !== 'idle') return;
    activeTab = key;
    loadTab(key);
  }

  function onTabKeydown(e, idx) {
    let next = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next == null) return;
    e.preventDefault();
    selectTab(TABS[next].key);
    requestAnimationFrame(() => {
      document.getElementById(`ao-tab-${TABS[next].key}`)?.focus();
    });
  }

  function applyRange() {
    rangeError = '';
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(rangeFrom) && /^\d{4}-\d{2}-\d{2}$/.test(rangeTo);
    if (!ok || rangeFrom > rangeTo) {
      rangeError = $_('settings.admin_overview.range_invalid');
      return;
    }
    openDays = {};
    if (isRangeTab) loadTab(activeTab);
  }

  // ── Safe formatting helpers ───────────────────────────────────────────────
  // Every value that reaches the DOM goes through one of these. Nothing here
  // ever emits JSON.stringify output, "[object Object]", "undefined" or "NaN".

  function parseMaybe(v) {
    if (v == null) return null;
    if (typeof v !== 'string') return v;
    const s = v.trim();
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try { return JSON.parse(s); } catch { return v; }
    }
    return v;
  }

  function isObj(v) {
    return v != null && typeof v === 'object' && !Array.isArray(v);
  }

  function numOrNull(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function fmtNum(v, digits = 0) {
    const n = numOrNull(v);
    if (n == null) return '—';
    if (digits > 0) return n.toFixed(digits);
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  function scalarText(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (Array.isArray(v)) return v.map(scalarText).filter(Boolean).join(', ');
    return '';
  }

  function text(v) {
    return scalarText(v).trim();
  }

  function humanKey(k) {
    const s = String(k || '').replace(/[_-]+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  function kvList(v) {
    const obj = parseMaybe(v);
    if (!isObj(obj)) return [];
    return Object.entries(obj)
      .map(([k, val]) => ({ key: k, label: humanKey(k), value: scalarText(val) }))
      .filter(r => r.value !== '');
  }

  function nutritionOf(row) {
    const n = parseMaybe(row?.nutrition);
    return isObj(n) ? n : {};
  }

  function kcalOf(row) {
    const n = nutritionOf(row);
    return numOrNull(n.calories ?? n.kcal ?? n.energy);
  }

  function quantityOf(row) {
    const q = numOrNull(row?.quantity);
    return q == null || q === 0 ? 1 : q;
  }

  // Nutrition values are per serving; quantity is the number of servings,
  // matching Nutrition.calculate() and the backend day totals.
  function scaledNutrition(row) {
    const n = nutritionOf(row);
    const q = quantityOf(row);
    if (q === 1) return n;
    const out = {};
    for (const [k, v] of Object.entries(n)) {
      const num = numOrNull(v);
      out[k] = num == null ? v : num * q;
    }
    return out;
  }

  function scaledKcal(row) {
    const n = scaledNutrition(row);
    return numOrNull(n.calories ?? n.kcal ?? n.energy);
  }

  function macroList(nutrition) {
    const n = isObj(nutrition) ? nutrition : {};
    const out = [];
    const add = (label, value, unit) => {
      const v = numOrNull(value);
      if (v != null) out.push({ label, value: fmtNum(v, unit === 'g' ? 1 : 0), unit });
    };
    add($_('settings.admin_overview.macro_protein'), n.proteins ?? n.protein, 'g');
    add($_('settings.admin_overview.macro_carbs'), n.carbohydrates ?? n.carbs, 'g');
    add($_('settings.admin_overview.macro_fat'), n.fat, 'g');
    add($_('settings.admin_overview.macro_fiber'), n.fiber, 'g');
    add($_('settings.admin_overview.macro_sugar'), n.sugars ?? n.sugar, 'g');
    add($_('settings.admin_overview.macro_sodium'), n.sodium, 'mg');
    return out;
  }

  // Compact P/C/F figures for dense rows. Fiber, sugar and sodium stay at the
  // day-total level so item rows do not become a wall of chips.
  function coreMacros(nutrition) {
    const n = isObj(nutrition) ? nutrition : {};
    const out = [];
    const add = (shortKey, labelKey, value) => {
      const v = numOrNull(value);
      if (v != null) {
        out.push({
          short: $_(shortKey),
          label: $_(labelKey),
          value: fmtNum(v, 1),
        });
      }
    };
    add('settings.admin_overview.macro_protein_short', 'settings.admin_overview.macro_protein', n.proteins ?? n.protein);
    add('settings.admin_overview.macro_carbs_short', 'settings.admin_overview.macro_carbs', n.carbohydrates ?? n.carbs);
    add('settings.admin_overview.macro_fat_short', 'settings.admin_overview.macro_fat', n.fat);
    return out;
  }

  // Macro composition by energy (protein/carbs 4 kcal/g, fat 9 kcal/g). Returns
  // null when there is no macro data, so the bar can show an honest empty state
  // instead of inventing a split.
  function macroSplit(totals) {
    const p = numOrNull(totals?.protein);
    const c = numOrNull(totals?.carbs);
    const f = numOrNull(totals?.fat);
    if (p == null && c == null && f == null) return null;
    const pe = (p || 0) * 4;
    const ce = (c || 0) * 4;
    const fe = (f || 0) * 9;
    const total = pe + ce + fe;
    if (!(total > 0)) return null;
    let protein = Math.round((pe / total) * 100);
    let carbs = Math.round((ce / total) * 100);
    let fat = 100 - protein - carbs;
    if (fat < 0) {
      carbs = Math.max(0, carbs + fat);
      fat = 0;
    }
    return { protein, carbs, fat };
  }

  function macroAria(totals) {
    const split = macroSplit(totals);
    if (!split) return $_('settings.admin_overview.macro_none');
    return $_('settings.admin_overview.macro_share_aria', {
      values: { protein: split.protein, carbs: split.carbs, fat: split.fat },
    });
  }

  // At-a-glance summary of the selected range. Derived entirely from the rows
  // already fetched for the Diary tab; no extra request.
  function rangeSummary(rows) {
    const days = Array.isArray(rows) ? rows : [];
    const kcal = [];
    let pSum = 0, cSum = 0, fSum = 0, pN = 0, cN = 0, fN = 0;
    const bars = [];
    for (const day of days) {
      const t = dayTotals(day);
      const k = numOrNull(t.kcal);
      if (k != null) kcal.push(k);
      const p = numOrNull(t.protein);
      const c = numOrNull(t.carbs);
      const f = numOrNull(t.fat);
      if (p != null) { pSum += p; pN++; }
      if (c != null) { cSum += c; cN++; }
      if (f != null) { fSum += f; fN++; }
      bars.push({ kcal: k, date: fmtDate(day.date) });
    }
    const maxKcal = kcal.length ? Math.max(...kcal) : 0;
    for (const b of bars) {
      b.pct = maxKcal > 0 && b.kcal != null ? Math.max(6, Math.round((b.kcal / maxKcal) * 100)) : 0;
    }
    return {
      days: days.length,
      avgKcal: kcal.length ? kcal.reduce((a, b) => a + b, 0) / kcal.length : null,
      avgProtein: pN ? pSum / pN : null,
      avgCarbs: cN ? cSum / cN : null,
      avgFat: fN ? fSum / fN : null,
      bars,
      maxKcal,
    };
  }

  function dayKey(day, idx) {
    return text(day?.date) || `#${idx}`;
  }

  function toggleDay(key) {
    openDays = { ...openDays, [key]: !openDays[key] };
  }

  function portionText(row) {
    const parts = [];
    const q = numOrNull(row?.quantity);
    if (q != null) parts.push(`${fmtNum(q)}×`);
    const p = numOrNull(row?.portion);
    const u = text(row?.unit);
    if (p != null) parts.push(u ? `${fmtNum(p)} ${u}` : fmtNum(p));
    else if (u) parts.push(u);
    return parts.join(' ');
  }

  function waterEntries(day) {
    const w = parseMaybe(day?.water);
    if (Array.isArray(w)) return w;
    if (isObj(w)) {
      if (Array.isArray(w.entries)) return w.entries;
      if (waterAmount(w) != null) return [w];
    }
    return [];
  }

  function waterAmount(entry) {
    if (typeof entry === 'number') return numOrNull(entry);
    const e = parseMaybe(entry);
    if (!isObj(e)) return null;
    for (const k of ['amount_ml', 'ml', 'amount', 'quantity', 'volume_ml', 'value']) {
      const n = numOrNull(e[k]);
      if (n != null) return n;
    }
    return null;
  }

  function waterLabel(entry) {
    if (typeof entry === 'number') return `${fmtNum(entry)} ml`;
    const e = parseMaybe(entry);
    if (isObj(e)) {
      const amount = waterAmount(e);
      const name = text(e.name || e.label || e.type || e.container);
      const bits = [];
      if (amount != null) bits.push(`${fmtNum(amount)} ml`);
      if (name) bits.push(name);
      return bits.join(' · ') || '—';
    }
    return text(entry) || '—';
  }

  function itemsOf(day) {
    const v = parseMaybe(day?.items);
    return Array.isArray(v) ? v : [];
  }

  function dayTotals(day) {
    const t = isObj(day?.totals) ? day.totals : {};
    const items = itemsOf(day);
    const sum = (pick) => items.reduce((acc, it) => acc + (numOrNull(pick(scaledNutrition(it))) || 0), 0);
    const pick = (k1, k2) => t[k1] != null ? t[k1] : (k2 ? t[k2] : undefined);
    const waterList = waterEntries(day);
    const waterSum = waterList.reduce((acc, e) => acc + (waterAmount(e) || 0), 0);
    return {
      kcal: pick('kcal', 'calories') ?? sum(n => n.calories ?? n.kcal ?? n.energy),
      protein: pick('protein', 'proteins') ?? sum(n => n.proteins ?? n.protein),
      carbs: pick('carbs', 'carbohydrates') ?? sum(n => n.carbohydrates ?? n.carbs),
      fat: t.fat ?? sum(n => n.fat),
      fiber: t.fiber ?? sum(n => n.fiber),
      sugar: pick('sugar', 'sugars') ?? sum(n => n.sugars ?? n.sugar),
      sodium: t.sodium ?? sum(n => n.sodium),
      water_ml: t.water_ml ?? (waterList.length ? waterSum : null),
      item_count: t.item_count ?? items.length,
    };
  }

  function completedMeals(day) {
    const c = parseMaybe(day?.completed_meals);
    if (Array.isArray(c)) return c.map(scalarText).filter(Boolean);
    if (isObj(c)) return Object.entries(c).filter(([, v]) => v === true || v === 'true').map(([k]) => humanKey(k));
    return [];
  }

  function bodyStats(day) {
    return kvList(day?.body_stats);
  }

  function fmtDate(v) {
    if (!v) return '';
    const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return text(v);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtShortDate(v) {
    if (!v) return '';
    const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return text(v);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function fmtDateTime(v) {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return text(v);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function durationText(minutes) {
    const m = numOrNull(minutes);
    if (m == null) return '—';
    if (m < 60) return `${fmtNum(m)} min`;
    const h = Math.floor(m / 60);
    const rem = Math.round(m % 60);
    return rem ? `${h}h ${rem}m` : `${h}h`;
  }

  function hoursText(hours) {
    const h = numOrNull(hours);
    if (h == null) return '—';
    const whole = Math.floor(h);
    const mins = Math.round((h - whole) * 60);
    return mins ? `${whole}h ${mins}m` : `${whole}h`;
  }

  function fastDuration(fast) {
    const explicit = numOrNull(fast?.duration_hours);
    if (explicit != null) return { hours: explicit, ongoing: false };
    const start = fast?.start_at ? new Date(fast.start_at) : null;
    const end = fast?.end_at ? new Date(fast.end_at) : null;
    if (start && !Number.isNaN(start.getTime())) {
      const stop = end && !Number.isNaN(end.getTime()) ? end : new Date();
      return { hours: (stop.getTime() - start.getTime()) / 3600000, ongoing: !end };
    }
    return { hours: null, ongoing: false };
  }

  function ingredientsOf(meal) {
    const raw = parseMaybe(meal?.ingredients);
    if (Array.isArray(raw)) {
      return raw.map((entry) => {
        if (entry == null) return { name: $_('settings.admin_overview.unknown_food'), portion: '' };
        if (typeof entry === 'string') return { name: entry, portion: '' };
        const e = parseMaybe(entry);
        if (!isObj(e)) return null;
        const name = text(e.name) || $_('settings.admin_overview.unknown_food');
        const portion = portionText(e);
        return { name, portion };
      }).filter(Boolean);
    }
    const items = parseMaybe(meal?.items);
    if (Array.isArray(items)) {
      return items.map((entry) => {
        const e = parseMaybe(entry);
        if (!isObj(e)) return null;
        return { name: text(e.name) || $_('settings.admin_overview.unnamed'), portion: portionText(e) };
      }).filter(Boolean);
    }
    return [];
  }

  function countValue(obj, ...keys) {
    if (!isObj(obj)) return null;
    for (const k of keys) {
      const n = numOrNull(obj[k]);
      if (n != null) return n;
    }
    return null;
  }

  function profileOf(d) {
    if (!d) return {};
    const p = d.profile || d.user;
    return isObj(p) ? p : d;
  }

  function countsOf(d) {
    if (isObj(d?.counts)) return d.counts;
    return isObj(d) ? d : {};
  }

  function userCounts(u) {
    if (!u) return [];
    return [
      { label: $_('settings.admin_overview.counts_diary'), value: u.diary_days },
      { label: $_('settings.admin_overview.counts_foods'), value: u.foods },
      { label: $_('settings.admin_overview.counts_meals'), value: u.meals },
      { label: $_('settings.admin_overview.counts_recipes'), value: u.recipes },
      { label: $_('settings.admin_overview.counts_activities'), value: u.activities },
      { label: $_('settings.admin_overview.counts_workouts'), value: u.workouts },
      { label: $_('settings.admin_overview.counts_wellness'), value: u.wellness_records },
      { label: $_('settings.admin_overview.counts_fasts'), value: u.fasts },
    ].filter(c => numOrNull(c.value) != null);
  }

  function detailCounts(d, fallback) {
    const src = countsOf(d);
    const base = isObj(fallback) ? fallback : {};
    const read = (k, alt) => countValue(src, k, alt) ?? countValue(base, k, alt);
    return [
      { label: $_('settings.admin_overview.counts_diary'), value: read('diary_days') },
      { label: $_('settings.admin_overview.counts_foods'), value: read('foods') },
      { label: $_('settings.admin_overview.counts_meals'), value: read('meals') },
      { label: $_('settings.admin_overview.counts_recipes'), value: read('recipes') },
      { label: $_('settings.admin_overview.counts_activities'), value: read('activities', 'activity_log') },
      { label: $_('settings.admin_overview.counts_workouts'), value: read('workouts') },
      { label: $_('settings.admin_overview.counts_fasts'), value: read('fasts') },
      { label: $_('settings.admin_overview.counts_wellness'), value: read('wellness_records', 'wellness_data') },
    ].filter(c => numOrNull(c.value) != null);
  }

  function totalStat(key) {
    return numOrNull(overview?.totals?.[key]);
  }

  function isEmptyTab(info) {
    return info.state === 'ready' && !info.rows.length;
  }

  function emptyKey(key) {
    const map = {
      diary: 'settings.admin_overview.empty_diary',
      foods: 'settings.admin_overview.empty_foods',
      meals: 'settings.admin_overview.empty_meals',
      activity: 'settings.admin_overview.empty_activity',
      wellness: 'settings.admin_overview.empty_wellness',
      fasts: 'settings.admin_overview.empty_fasts',
    };
    return map[key] || 'settings.admin_overview.empty_diary';
  }
</script>

{#if isNativeLocal}
  <div class="section-body">
    <div class="card settings-card">
      <div class="ao-message">
        <span class="material-symbols-rounded ao-message-icon">cloud_off</span>
        <div>
          <div class="ao-message-title">{$_('settings.admin_overview.server_required')}</div>
          <p class="ao-message-desc">{$_('settings.admin_overview.server_required_desc')}</p>
        </div>
      </div>
    </div>
  </div>
{:else if !$userMgmtActive}
  <div class="section-body">
    <div class="card settings-card">
      <div class="ao-message">
        <span class="material-symbols-rounded ao-message-icon">group_off</span>
        <div>
          <div class="ao-message-title">{$_('settings.admin_overview.single_user_title')}</div>
          <p class="ao-message-desc">{$_('settings.admin_overview.single_user_desc')}</p>
        </div>
      </div>
    </div>
  </div>
{:else if !isAdmin}
  <div class="section-body">
    <div class="card settings-card">
      <div class="ao-message">
        <span class="material-symbols-rounded ao-message-icon danger">lock</span>
        <div>
          <div class="ao-message-title">{$_('settings.admin_overview.access_denied')}</div>
          <p class="ao-message-desc">{$_('settings.admin_overview.access_denied_desc')}</p>
        </div>
      </div>
    </div>
  </div>
{:else}
  <div class="section-body ao-root">
    <div class="card settings-card ao-notice">
      <span class="material-symbols-rounded ao-notice-icon">visibility</span>
      <div class="ao-notice-text">
        <span class="ao-notice-title">{$_('settings.admin_overview.readonly_title')}</span>
        <span class="ao-notice-desc">{$_('settings.admin_overview.readonly_notice')}</span>
      </div>
      <span class="ao-readonly-badge">{$_('settings.admin_overview.read_only_badge')}</span>
    </div>

    {#if listState === 'loading' && !overview}
      <div class="card settings-card">
        <Spinner block label={$_('settings.admin_overview.loading')} />
      </div>
    {:else if listState === 'error' && !overview}
      <div class="card settings-card">
        <div class="ao-state ao-state-error">
          <span class="material-symbols-rounded">error</span>
          <div class="ao-state-title">{$_('settings.admin_overview.error_title')}</div>
          <p class="ao-state-desc">{listError || $_('settings.admin_overview.error_load_overview')}</p>
          <button class="btn btn-secondary" on:click={loadOverview}>{$_('settings.admin_overview.retry')}</button>
        </div>
      </div>
    {:else}
      {#if overview}
        <div class="ao-totals" aria-label={$_('settings.admin_overview.totals_heading')}>
          <div class="ao-totals-head">{$_('settings.admin_overview.totals_heading')}</div>
          <div class="ao-totals-grid">
            {#each [
              { key: 'users', label: $_('settings.admin_overview.stat_users'), icon: 'group' },
              { key: 'diary_days', label: $_('settings.admin_overview.stat_diary_days'), icon: 'calendar_month' },
              { key: 'foods', label: $_('settings.admin_overview.stat_foods'), icon: 'lunch_dining' },
              { key: 'meals', label: $_('settings.admin_overview.stat_meals'), icon: 'restaurant' },
              { key: 'recipes', label: $_('settings.admin_overview.stat_recipes'), icon: 'menu_book' },
              { key: 'activities', label: $_('settings.admin_overview.stat_activities'), icon: 'directions_run' },
              { key: 'workouts', label: $_('settings.admin_overview.stat_workouts'), icon: 'fitness_center' },
              { key: 'fasts', label: $_('settings.admin_overview.stat_fasts'), icon: 'timer' },
              { key: 'wellness_records', label: $_('settings.admin_overview.stat_wellness_records'), icon: 'favorite' },
            ] as stat}
              <div class="ao-stat">
                <span class="material-symbols-rounded ao-stat-icon">{stat.icon}</span>
                <span class="ao-stat-value">{fmtNum(totalStat(stat.key))}</span>
                <span class="ao-stat-label">{stat.label}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <div class="ao-layout">
        <aside class="card settings-card ao-list-card">
          <div class="ao-list-head">
            <span>{$_('settings.admin_overview.users_heading')}</span>
            <span class="ao-list-count">{users.length}</span>
          </div>

          {#if listState === 'loading'}
            <Spinner block label={$_('settings.admin_overview.loading')} />
          {:else if listState === 'error'}
            <div class="ao-state ao-state-error ao-state-compact">
              <span class="material-symbols-rounded">error</span>
              <p class="ao-state-desc">{listError || $_('settings.admin_overview.error_load_overview')}</p>
              <button class="btn btn-secondary" on:click={loadOverview}>{$_('settings.admin_overview.retry')}</button>
            </div>
          {:else if !users.length}
            <div class="ao-state ao-state-empty">
              <span class="material-symbols-rounded">group_off</span>
              <div class="ao-state-title">{$_('settings.admin_overview.users_empty')}</div>
              <p class="ao-state-desc">{$_('settings.admin_overview.users_empty_desc')}</p>
            </div>
          {:else}
            <div class="ao-user-list">
              {#each users as u (u.id)}
                {@const counts = userCounts(u)}
                <button
                  type="button"
                  class="ao-user"
                  class:active={u.id === selectedId}
                  aria-current={u.id === selectedId ? 'true' : undefined}
                  on:click={() => selectUser(u)}>
                  <span class="ao-avatar">
                    {#if text(u.avatar_url)}
                      <img src={resolveAssetUrl(text(u.avatar_url))} alt="" loading="lazy" />
                    {:else}
                      <span class="material-symbols-rounded">person</span>
                    {/if}
                  </span>
                  <span class="ao-user-main">
                    <span class="ao-user-name">{text(u.nickname) || text(u.full_name) || text(u.username) || $_('settings.admin_overview.unnamed')}</span>
                    <span class="ao-user-sub">@{text(u.username)}</span>
                    <span class="ao-user-meta">
                      <span class="ao-role" class:admin={u.role === 'admin'}>
                        {u.role === 'admin' ? $_('settings.admin_overview.role_admin') : $_('settings.admin_overview.role_user')}
                      </span>
                      <span class="ao-last-diary">
                        {$_('settings.admin_overview.last_diary')}:
                        {u.last_diary_date ? fmtDate(u.last_diary_date) : $_('settings.admin_overview.never')}
                      </span>
                    </span>
                    {#if counts.length}
                      <span class="ao-user-counts">
                        {#each counts as c}
                          <span class="ao-user-count"><b>{fmtNum(c.value)}</b> {c.label}</span>
                        {/each}
                      </span>
                    {/if}
                  </span>
                </button>
              {/each}
            </div>
          {/if}
        </aside>

        <section class="ao-detail">
          {#if !selectedUser}
            <div class="card settings-card">
              <div class="ao-state ao-state-empty">
                <span class="material-symbols-rounded">person_search</span>
                <p class="ao-state-desc">{$_('settings.admin_overview.select_user_hint')}</p>
              </div>
            </div>
          {:else}
            {@const profile = profileOf(detail)}
            {@const headerName = text(profile.nickname) || text(profile.full_name) || text(selectedUser.nickname) || text(selectedUser.full_name) || text(selectedUser.username) || $_('settings.admin_overview.unnamed')}
            {@const headerAvatar = text(profile.avatar_url) || text(selectedUser.avatar_url)}
            {@const dCounts = detailCounts(detail, selectedUser)}
            <div class="card settings-card ao-profile">
              <div class="ao-profile-top">
                <span class="ao-avatar ao-avatar-lg">
                  {#if headerAvatar}
                    <img src={resolveAssetUrl(headerAvatar)} alt="" loading="lazy" />
                  {:else}
                    <span class="material-symbols-rounded">person</span>
                  {/if}
                </span>
                <div class="ao-profile-id">
                  <div class="ao-profile-name">{headerName}</div>
                  <div class="ao-profile-sub">@{text(profile.username) || text(selectedUser.username)}</div>
                  <div class="ao-profile-tags">
                    <span class="ao-role" class:admin={(profile.role || selectedUser.role) === 'admin'}>
                      {(profile.role || selectedUser.role) === 'admin' ? $_('settings.admin_overview.role_admin') : $_('settings.admin_overview.role_user')}
                    </span>
                    {#if profile.created_at || selectedUser.created_at}
                      <span class="ao-created">{$_('settings.admin_overview.created')}: {fmtDate(profile.created_at || selectedUser.created_at)}</span>
                    {/if}
                  </div>
                </div>
              </div>

              {#if detailState === 'loading'}
                <div class="ao-profile-loading">
                  <span class="skeleton" style="height:10px;width:38%"></span>
                  <span class="skeleton" style="height:10px;width:62%"></span>
                </div>
              {:else if detailState === 'error'}
                <div class="ao-inline-error">
                  <span class="material-symbols-rounded">error</span>
                  <span>{detailError || $_('settings.admin_overview.error_load_detail')}</span>
                  <button class="btn btn-secondary ao-inline-retry" on:click={loadDetail}>{$_('settings.admin_overview.retry')}</button>
                </div>
              {/if}

              {#if dCounts.length}
                <div class="ao-count-grid">
                  {#each dCounts as c}
                    <div class="ao-count">
                      <span class="ao-count-value">{fmtNum(c.value)}</span>
                      <span class="ao-count-label">{c.label}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>

            <div class="ao-tabbar" role="tablist" aria-label={$_('settings.admin_overview.section')}>
              {#each TABS as tab, i}
                <button
                  type="button"
                  id={`ao-tab-${tab.key}`}
                  class="ao-tab"
                  class:active={activeTab === tab.key}
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  aria-controls="ao-tabpanel"
                  tabindex={activeTab === tab.key ? 0 : -1}
                  on:click={() => selectTab(tab.key)}
                  on:keydown={(e) => onTabKeydown(e, i)}>
                  <span class="material-symbols-rounded">{tab.icon}</span>
                  <span>{$_(tab.labelKey)}</span>
                </button>
              {/each}
            </div>

            <div class="ao-panel" id="ao-tabpanel" role="tabpanel" aria-labelledby={`ao-tab-${activeTab}`}>
              {#if isRangeTab}
                <div class="ao-range">
                  <label class="ao-range-field">
                    <span>{$_('settings.admin_overview.date_from')}</span>
                    <input class="input ao-date" type="date" bind:value={rangeFrom} max={rangeTo} on:change={applyRange} />
                  </label>
                  <label class="ao-range-field">
                    <span>{$_('settings.admin_overview.date_to')}</span>
                    <input class="input ao-date" type="date" bind:value={rangeTo} min={rangeFrom} on:change={applyRange} />
                  </label>
                  {#if rangeError}<span class="ao-range-error">{rangeError}</span>{/if}
                </div>
              {/if}

              {#if tabInfo.state === 'loading'}
                <div class="card settings-card">
                  <Spinner block label={$_('settings.admin_overview.loading')} />
                </div>
              {:else if tabInfo.state === 'error'}
                <div class="card settings-card">
                  <div class="ao-state ao-state-error">
                    <span class="material-symbols-rounded">error</span>
                    <div class="ao-state-title">{$_('settings.admin_overview.error_title')}</div>
                    <p class="ao-state-desc">{tabInfo.error || $_('settings.admin_overview.error_load_tab')}</p>
                    <button class="btn btn-secondary" on:click={() => loadTab(activeTab)}>{$_('settings.admin_overview.retry')}</button>
                  </div>
                </div>
              {:else if isEmptyTab(tabInfo)}
                <div class="card settings-card">
                  <div class="ao-state ao-state-empty">
                    <span class="material-symbols-rounded">
                      {activeTab === 'diary' ? 'menu_book' : activeTab === 'foods' ? 'lunch_dining' : activeTab === 'meals' ? 'restaurant' : activeTab === 'activity' ? 'directions_run' : activeTab === 'wellness' ? 'favorite' : 'timer'}
                    </span>
                    <div class="ao-state-title">{$_(emptyKey(activeTab))}</div>
                    <p class="ao-state-desc">{$_('settings.admin_overview.empty_hint')}</p>
                  </div>
                </div>
              {:else}
                {#if tabInfo.truncated}
                  <div class="ao-truncated">
                    <span class="material-symbols-rounded">info</span>
                    <span>{$_(`settings.admin_overview.truncated`, { values: { shown: tabRows.length, total: tabInfo.total } })}</span>
                  </div>
                {/if}

                {#if activeTab === 'diary'}
                  {@const range = rangeSummary(tabRows)}
                  <div class="ao-range-summary" aria-label={$_('settings.admin_overview.range_heading')}>
                    <div class="ao-rs-head">
                      <span class="ao-rs-title">{$_('settings.admin_overview.range_heading')}</span>
                      <span class="ao-rs-range">{fmtShortDate(rangeFrom)} – {fmtShortDate(rangeTo)}</span>
                    </div>
                    <div class="ao-rs-body">
                      <div class="ao-rs-stats">
                        <div class="ao-rs-stat">
                          <span class="ao-rs-value">{fmtNum(range.days)}</span>
                          <span class="ao-rs-label">{$_('settings.admin_overview.range_days')}</span>
                        </div>
                        <div class="ao-rs-stat">
                          <span class="ao-rs-value">{fmtNum(range.avgKcal)}</span>
                          <span class="ao-rs-label">{$_('settings.admin_overview.range_avg_kcal')}</span>
                        </div>
                        <div class="ao-rs-macros">
                          <span class="ao-rs-macro p"><b>{$_('settings.admin_overview.macro_protein_short')}</b> {fmtNum(range.avgProtein, 1)}g</span>
                          <span class="ao-rs-macro c"><b>{$_('settings.admin_overview.macro_carbs_short')}</b> {fmtNum(range.avgCarbs, 1)}g</span>
                          <span class="ao-rs-macro f"><b>{$_('settings.admin_overview.macro_fat_short')}</b> {fmtNum(range.avgFat, 1)}g</span>
                        </div>
                      </div>
                      {#if range.bars.length}
                        <div class="ao-rs-bars" role="img" aria-label={$_('settings.admin_overview.range_kcal_aria')}>
                          {#each range.bars as b}
                            <span
                              class="ao-rs-bar"
                              style={`height:${b.pct}%`}
                              title={b.kcal != null ? `${b.date} · ${fmtNum(b.kcal)} ${$_('settings.admin_overview.kcal')}` : b.date}></span>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  </div>

                  <div class="ao-day-list">
                    {#each tabRows as day, di}
                      {@const key = dayKey(day, di)}
                      {@const open = !!openDays[key]}
                      {@const totals = dayTotals(day)}
                      {@const items = itemsOf(day)}
                      {@const waters = waterEntries(day)}
                      {@const stats = bodyStats(day)}
                      {@const mealsDone = completedMeals(day)}
                      {@const split = macroSplit(totals)}
                      <div class="card settings-card ao-day" class:open={open}>
                        <div class="ao-day-summary">
                          <div class="ao-day-date">
                            <span class="material-symbols-rounded">calendar_month</span>
                            <span>{fmtDate(day.date)}</span>
                          </div>
                          <div class="ao-day-macrobar" role="img" aria-label={macroAria(totals)}>
                            {#if split}
                              <span class="ao-mb-seg p" style={`flex:0 0 ${split.protein}%`}></span>
                              <span class="ao-mb-seg c" style={`flex:0 0 ${split.carbs}%`}></span>
                              <span class="ao-mb-seg f" style={`flex:0 0 ${split.fat}%`}></span>
                            {:else}
                              <span class="ao-mb-empty"></span>
                            {/if}
                          </div>
                          <div class="ao-day-kcal">
                            <span>{fmtNum(totals.kcal)}</span>
                            <span class="ao-day-kcal-unit">{$_('settings.admin_overview.kcal')}</span>
                          </div>
                          <div class="ao-day-meta">
                            {#if totals.water_ml != null}
                              <span class="ao-day-water">
                                <span class="material-symbols-rounded">water_drop</span>
                                {fmtNum(totals.water_ml)} ml
                              </span>
                            {/if}
                            <button
                              type="button"
                              class="ao-day-toggle"
                              aria-expanded={open}
                              aria-controls={`ao-day-body-${di}`}
                              aria-label={open
                                ? $_('settings.admin_overview.hide_items', { values: { count: fmtNum(totals.item_count) } })
                                : $_('settings.admin_overview.show_items', { values: { count: fmtNum(totals.item_count) } })}
                              on:click={() => toggleDay(key)}>
                              <span class="ao-day-toggle-text" aria-hidden="true">
                                {open
                                  ? $_('settings.admin_overview.hide_items', { values: { count: fmtNum(totals.item_count) } })
                                  : $_('settings.admin_overview.show_items', { values: { count: fmtNum(totals.item_count) } })}
                              </span>
                              <span class="material-symbols-rounded ao-day-chevron" class:open aria-hidden="true">expand_more</span>
                            </button>
                          </div>
                        </div>

                        {#if open}
                          <div class="ao-day-body" id={`ao-day-body-${di}`}>
                            <div class="ao-day-totals">
                              {#each macroList({ proteins: totals.protein, carbohydrates: totals.carbs, fat: totals.fat, fiber: totals.fiber, sugars: totals.sugar, sodium: totals.sodium }) as m}
                                <span class="ao-macro"><b>{m.label}</b> {m.value}{m.unit}</span>
                              {/each}
                              {#if totals.water_ml != null}
                                <span class="ao-macro water"><b>{$_('settings.admin_overview.water')}</b> {fmtNum(totals.water_ml)} ml</span>
                              {/if}
                            </div>

                            {#if items.length}
                              <div class="ao-items">
                                {#each items as item}
                                  {@const figs = coreMacros(scaledNutrition(item))}
                                  <div class="ao-item">
                                    <span class="ao-item-name" title={text(item.name) || $_('settings.admin_overview.unnamed')}>{text(item.name) || $_('settings.admin_overview.unnamed')}</span>
                                    <span class="ao-item-portion">{portionText(item) || '—'}</span>
                                    <span class="ao-item-kcal">{fmtNum(scaledKcal(item))} <small>{$_('settings.admin_overview.kcal')}</small></span>
                                    <span class="ao-item-figs">
                                      {#each figs as m}
                                        <span class="ao-fig" title={m.label} aria-label={`${m.label} ${m.value}g`}><b>{m.short}</b>{m.value}g</span>
                                      {/each}
                                    </span>
                                  </div>
                                {/each}
                              </div>
                            {:else}
                              <p class="ao-empty-line">{$_('settings.admin_overview.empty_diary')}</p>
                            {/if}

                            {#if waters.length}
                              <div class="ao-day-section">
                                <div class="ao-day-section-label">{$_('settings.admin_overview.water')}</div>
                                <div class="ao-pill-row">
                                  {#each waters as w}
                                    <span class="chip">{waterLabel(w)}</span>
                                  {/each}
                                </div>
                              </div>
                            {/if}

                            {#if stats.length}
                              <div class="ao-day-section">
                                <div class="ao-day-section-label">{$_('settings.admin_overview.body_stats')}</div>
                                <div class="ao-pill-row">
                                  {#each stats as s}
                                    <span class="chip">{s.label}: {s.value}</span>
                                  {/each}
                                </div>
                              </div>
                            {/if}

                            {#if mealsDone.length}
                              <div class="ao-day-section">
                                <div class="ao-day-section-label">{$_('settings.admin_overview.completed_meals')}</div>
                                <div class="ao-pill-row">
                                  {#each mealsDone as m}
                                    <span class="chip accent">{m}</span>
                                  {/each}
                                </div>
                              </div>
                            {/if}

                            {#if text(day.notes)}
                              <div class="ao-day-section">
                                <div class="ao-day-section-label">{$_('settings.admin_overview.notes')}</div>
                                <p class="ao-notes">{text(day.notes)}</p>
                              </div>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>

                {:else if activeTab === 'foods'}
                  <div class="card settings-card ao-rows">
                    {#each tabRows as food}
                      {@const figs = coreMacros(nutritionOf(food))}
                      <div class="ao-row">
                        <div class="ao-row-main">
                          <span class="ao-row-name">{text(food.name) || $_('settings.admin_overview.unnamed')}</span>
                          <div class="ao-row-tags">
                            {#if text(food.brand)}<span class="ao-row-sub">{$_('settings.admin_overview.brand')}: {text(food.brand)}</span>{/if}
                            {#if text(food.category)}<span class="chip ao-chip">{text(food.category)}</span>{/if}
                            {#if portionText(food)}<span class="ao-row-sub">{portionText(food)}</span>{/if}
                            {#if text(food.barcode)}<span class="ao-row-sub">{$_('settings.admin_overview.barcode')}: {text(food.barcode)}</span>{/if}
                          </div>
                        </div>
                        <div class="ao-row-right">
                          <span class="ao-row-kcal">{fmtNum(kcalOf(food))} <small>{$_('settings.admin_overview.kcal')}</small></span>
                          {#if figs.length}
                            <div class="ao-figures">
                              {#each figs as m}
                                <span class="ao-fig" title={m.label} aria-label={`${m.label} ${m.value}g`}><b>{m.short}</b>{m.value}g</span>
                              {/each}
                            </div>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>

                {:else if activeTab === 'meals'}
                  <div class="card settings-card ao-rows">
                    {#each tabRows as meal}
                      {@const figs = coreMacros(nutritionOf(meal))}
                      {@const ingredients = ingredientsOf(meal)}
                      <div class="ao-row">
                        <div class="ao-row-main">
                          <span class="ao-row-name">{text(meal.name) || $_('settings.admin_overview.unnamed')}</span>
                          <div class="ao-row-tags">
                            <span class="chip accent">{meal.is_recipe ? $_('settings.admin_overview.recipe') : $_('settings.admin_overview.meal')}</span>
                            {#if numOrNull(meal.servings) != null}<span class="ao-row-sub">{$_('settings.admin_overview.servings')}: {fmtNum(meal.servings)}</span>{/if}
                            {#if portionText(meal)}<span class="ao-row-sub">{portionText(meal)}</span>{/if}
                          </div>
                          {#if ingredients.length}
                            <details class="ao-meal-details">
                              <summary>
                                <span class="material-symbols-rounded ao-meal-chevron" aria-hidden="true">chevron_right</span>
                                <span>{$_('settings.admin_overview.ingredients')} ({ingredients.length})</span>
                              </summary>
                              <div class="ao-ingredients">
                                {#each ingredients as ing}
                                  <div class="ao-ingredient">
                                    <span>{ing.name}</span>
                                    {#if ing.portion}<span class="ao-row-sub">{ing.portion}</span>{/if}
                                  </div>
                                {/each}
                              </div>
                            </details>
                          {:else}
                            <span class="ao-row-sub">{$_('settings.admin_overview.no_ingredients')}</span>
                          {/if}
                        </div>
                        <div class="ao-row-right">
                          <span class="ao-row-kcal">{fmtNum(kcalOf(meal))} <small>{$_('settings.admin_overview.kcal')}</small></span>
                          {#if figs.length}
                            <div class="ao-figures">
                              {#each figs as m}
                                <span class="ao-fig" title={m.label} aria-label={`${m.label} ${m.value}g`}><b>{m.short}</b>{m.value}g</span>
                              {/each}
                            </div>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>

                {:else if activeTab === 'activity'}
                  <div class="card settings-card ao-rows">
                    {#each tabRows as act}
                      <div class="ao-row">
                        <div class="ao-row-main">
                          <span class="ao-row-name">{text(act.name) || $_('settings.admin_overview.unnamed')}</span>
                          <div class="ao-row-tags">
                            <span class="ao-row-sub">{fmtDate(act.date)}</span>
                            {#if text(act.source)}<span class="chip ao-chip">{$_('settings.admin_overview.source')}: {text(act.source)}</span>{/if}
                            {#if numOrNull(act.met) != null}<span class="ao-row-sub">{$_('settings.admin_overview.met')}: {fmtNum(act.met, 1)}</span>{/if}
                          </div>
                        </div>
                        <div class="ao-row-right">
                          <span class="ao-row-kcal">{fmtNum(act.kcal)} {$_('settings.admin_overview.kcal')}</span>
                          <div class="ao-macro-row">
                            <span class="ao-macro"><b>{$_('settings.admin_overview.duration')}</b> {durationText(act.duration_min)}</span>
                            {#if text(act.distance)}
                              <span class="ao-macro"><b>{$_('settings.admin_overview.distance')}</b> {text(act.distance)}</span>
                            {/if}
                          </div>
                        </div>
                      </div>
                    {/each}
                  </div>

                {:else if activeTab === 'wellness'}
                  <div class="card settings-card ao-rows">
                    {#each tabRows as w}
                      {@const meta = kvList(w.metadata)}
                      <div class="ao-row">
                        <div class="ao-row-main">
                          <span class="ao-row-name">{humanKey(w.metric_type) || $_('settings.admin_overview.metric')}</span>
                          <div class="ao-row-tags">
                            <span class="ao-row-sub">{fmtDate(w.date)}</span>
                            {#if text(w.source)}<span class="chip ao-chip">{$_('settings.admin_overview.source')}: {text(w.source)}</span>{/if}
                          </div>
                          {#if meta.length}
                            <div class="ao-meta-list">
                              {#each meta as m}
                                <span class="ao-row-sub">{m.label}: {m.value}</span>
                              {/each}
                            </div>
                          {/if}
                        </div>
                        <div class="ao-row-right">
                          <span class="ao-row-kcal">{text(w.value) || fmtNum(w.value)}</span>
                        </div>
                      </div>
                    {/each}
                  </div>

                {:else if activeTab === 'fasts'}
                  <div class="card settings-card ao-rows">
                    {#each tabRows as fast}
                      {@const dur = fastDuration(fast)}
                      <div class="ao-row">
                        <div class="ao-row-main">
                          <span class="ao-row-name">
                            {$_('settings.admin_overview.duration')}: {hoursText(dur.hours)}
                            {#if dur.ongoing}<span class="chip accent">{$_('settings.admin_overview.ongoing')}</span>{/if}
                          </span>
                          <div class="ao-row-tags">
                            <span class="ao-row-sub">{$_('settings.admin_overview.started')}: {fmtDateTime(fast.start_at)}</span>
                            {#if fast.end_at}<span class="ao-row-sub">{$_('settings.admin_overview.ended')}: {fmtDateTime(fast.end_at)}</span>{/if}
                            {#if numOrNull(fast.goal_hours) != null}<span class="ao-row-sub">{$_('settings.admin_overview.goal')}: {hoursText(fast.goal_hours)}</span>{/if}
                          </div>
                          {#if text(fast.notes)}<p class="ao-notes">{text(fast.notes)}</p>{/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          {/if}
        </section>
      </div>
    {/if}
  </div>
{/if}

<style>
  .ao-root { min-width: 0; }

  /* Read-only notice */
  .ao-notice {
    flex-direction: row;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    background: var(--accent-dim);
    border-color: transparent;
  }
  .ao-notice-icon { color: var(--accent); font-size: 20px; flex-shrink: 0; }
  .ao-notice-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
  .ao-notice-title { font-size: 13px; font-weight: 600; color: var(--text-1); }
  .ao-notice-desc { font-size: 12px; color: var(--text-2); line-height: 1.4; }
  .ao-readonly-badge {
    flex-shrink: 0;
    font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--accent);
    background: var(--surface-1);
    border-radius: var(--radius-full);
    padding: 3px 8px;
  }

  /* Totals strip */
  .ao-totals {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 12px 14px;
    min-width: 0;
  }
  .ao-totals-head {
    font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--text-3); margin-bottom: 10px;
  }
  .ao-totals-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(78px, 1fr));
    gap: 8px;
  }
  .ao-stat {
    display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
    background: var(--surface-2);
    border-radius: var(--radius-md);
    padding: 8px 10px;
    min-width: 0;
  }
  .ao-stat-icon { font-size: 16px; color: var(--accent); }
  .ao-stat-value { font-size: 17px; font-weight: 700; color: var(--text-1); line-height: 1.2; }
  .ao-stat-label { font-size: 10px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }

  /* Two-pane layout */
  .ao-layout {
    display: grid;
    grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
    gap: 12px;
    align-items: start;
    min-width: 0;
  }
  .ao-list-card { min-width: 0; }
  .ao-list-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 14px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--text-3);
    border-bottom: 1px solid var(--border);
  }
  .ao-list-count {
    font-size: 11px; color: var(--text-2);
    background: var(--surface-2); border-radius: var(--radius-full);
    padding: 1px 8px; letter-spacing: 0;
  }
  .ao-user-list {
    display: flex; flex-direction: column; gap: 2px;
    padding: 6px;
    max-height: 68vh;
    overflow-y: auto;
  }
  .ao-user {
    display: flex; align-items: flex-start; gap: 10px;
    width: 100%;
    padding: 9px 8px;
    background: none;
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    color: var(--text-1);
    transition: background var(--dur-fast);
    min-width: 0;
  }
  .ao-user:hover { background: var(--surface-2); }
  .ao-user.active { background: var(--accent-dim); }
  .ao-user.active .ao-user-name { color: var(--accent); }
  .ao-avatar {
    width: 36px; height: 36px; flex-shrink: 0;
    border-radius: 50%;
    background: var(--surface-3);
    color: var(--text-3);
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  .ao-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .ao-avatar .material-symbols-rounded { font-size: 20px; }
  .ao-avatar-lg { width: 48px; height: 48px; }
  .ao-avatar-lg .material-symbols-rounded { font-size: 26px; }
  .ao-user-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
  .ao-user-name { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ao-user-sub { font-size: 11px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ao-user-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 3px; }
  .ao-last-diary { font-size: 10px; color: var(--text-3); }
  .ao-user-counts { display: flex; flex-wrap: wrap; gap: 3px 8px; margin-top: 3px; }
  .ao-user-count { font-size: 10px; color: var(--text-3); }
  .ao-user-count b { color: var(--text-2); font-weight: 600; }

  .ao-role {
    font-size: 10px; font-weight: 700; text-transform: capitalize;
    color: var(--text-2);
    background: var(--surface-2);
    border-radius: var(--radius-full);
    padding: 1px 7px;
  }
  .ao-role.admin { color: var(--accent); background: var(--accent-dim); }

  /* Detail */
  .ao-detail { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .ao-profile { padding: 14px; gap: 12px; }
  .ao-profile-top { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .ao-profile-id { min-width: 0; }
  .ao-profile-name { font-size: 17px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ao-profile-sub { font-size: 12px; color: var(--text-3); }
  .ao-profile-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px; }
  .ao-created { font-size: 10px; color: var(--text-3); }
  .ao-profile-loading { display: flex; flex-direction: column; gap: 6px; }
  .ao-count-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(66px, 1fr));
    gap: 6px;
  }
  .ao-count {
    background: var(--surface-2);
    border-radius: var(--radius-md);
    padding: 7px 9px;
    display: flex; flex-direction: column; min-width: 0;
  }
  .ao-count-value { font-size: 15px; font-weight: 700; color: var(--text-1); }
  .ao-count-label { font-size: 10px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .ao-inline-error {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    font-size: 12px; color: var(--danger);
  }
  .ao-inline-error .material-symbols-rounded { font-size: 18px; }
  .ao-inline-retry { height: 30px; padding: 0 10px; font-size: 12px; }

  /* Tabs */
  .ao-tabbar {
    display: flex;
    gap: 2px;
    background: var(--surface-2);
    border-radius: var(--radius-md);
    padding: 3px;
    overflow-x: auto;
    scrollbar-width: none;
    max-width: 100%;
  }
  .ao-tabbar::-webkit-scrollbar { display: none; }
  .ao-tab {
    display: inline-flex; align-items: center; gap: 5px;
    flex: 0 0 auto;
    padding: 7px 11px;
    border: none;
    background: none;
    border-radius: calc(var(--radius-md) - 3px);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: background var(--dur-fast), color var(--dur-fast);
  }
  .ao-tab .material-symbols-rounded { font-size: 16px; }
  .ao-tab:hover { color: var(--text-1); }
  .ao-tab.active { background: var(--surface-1); color: var(--accent); box-shadow: var(--shadow-sm); }
  .ao-tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

  .ao-panel { display: flex; flex-direction: column; gap: 8px; min-width: 0; }

  /* Date range */
  .ao-range {
    display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 10px 12px;
  }
  .ao-range-field { display: flex; flex-direction: column; gap: 4px; min-width: 130px; flex: 1 1 130px; }
  .ao-range-field span { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-3); }
  .ao-date { height: 36px; font-size: 13px; padding: 0 10px; }
  .ao-range-error { flex-basis: 100%; font-size: 12px; color: var(--danger); }

  /* State blocks */
  .ao-state {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; text-align: center;
    padding: 32px 18px;
    color: var(--text-3);
  }
  .ao-state .material-symbols-rounded { font-size: 34px; color: var(--text-3); }
  .ao-state-error .material-symbols-rounded { color: var(--danger); }
  .ao-state-title { font-size: 14px; font-weight: 600; color: var(--text-1); }
  .ao-state-desc { font-size: 12px; color: var(--text-3); line-height: 1.45; margin: 0; max-width: 420px; }
  .ao-state-compact { padding: 18px 12px; }

  .ao-message {
    display: flex; align-items: flex-start; gap: 12px;
    padding: 18px 16px;
  }
  .ao-message-icon { font-size: 26px; color: var(--text-3); flex-shrink: 0; }
  .ao-message-icon.danger { color: var(--danger); }
  .ao-message-title { font-size: 14px; font-weight: 600; color: var(--text-1); }
  .ao-message-desc { font-size: 12px; color: var(--text-3); line-height: 1.45; margin: 3px 0 0; }

  /* Truncated notice */
  .ao-truncated {
    display: flex; align-items: center; gap: 7px;
    font-size: 12px; color: var(--text-2);
    background: var(--surface-2);
    border-radius: var(--radius-md);
    padding: 8px 11px;
  }
  .ao-truncated .material-symbols-rounded { font-size: 16px; color: var(--accent); flex-shrink: 0; }

  /* Range overview strip */
  .ao-range-summary {
    display: flex; flex-direction: column; gap: 8px;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 10px 14px;
    min-width: 0;
  }
  .ao-rs-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .ao-rs-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3); }
  .ao-rs-range { font-size: 11px; color: var(--text-3); }
  .ao-rs-body { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; min-width: 0; }
  .ao-rs-stats { display: flex; align-items: flex-end; gap: 18px; flex-wrap: wrap; min-width: 0; }
  .ao-rs-stat { display: flex; flex-direction: column; gap: 1px; }
  .ao-rs-value { font-size: 18px; font-weight: 700; color: var(--text-1); line-height: 1.15; font-variant-numeric: tabular-nums; }
  .ao-rs-label { font-size: 10px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
  .ao-rs-macros { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .ao-rs-macro { font-size: 11px; color: var(--text-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ao-rs-macro b { font-weight: 700; }
  .ao-rs-macro.p b { color: var(--macro-protein); }
  .ao-rs-macro.c b { color: var(--macro-carbs); }
  .ao-rs-macro.f b { color: var(--macro-fat); }
  .ao-rs-bars {
    display: flex; align-items: flex-end; gap: 3px;
    height: 30px; flex: 1 1 120px; min-width: 90px;
    padding: 2px 0;
  }
  .ao-rs-bar {
    flex: 1 1 0; min-width: 2px; min-height: 2px;
    background: linear-gradient(180deg, var(--accent), var(--accent-2));
    border-radius: 2px 2px 1px 1px;
    opacity: 0.65;
  }
  .ao-rs-bar:last-child { opacity: 1; }

  /* Diary days — one scannable row per day, items behind a disclosure */
  .ao-day-list { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .ao-day { padding: 0; gap: 0; }
  .ao-day:hover { transform: none; box-shadow: none; }
  .ao-day-summary {
    display: flex; align-items: center; flex-wrap: wrap;
    gap: 6px 12px;
    padding: 9px 12px;
    min-width: 0;
  }
  .ao-day-date {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 13px; font-weight: 600; color: var(--text-1);
    min-width: 0; flex: 0 1 auto;
  }
  .ao-day-date span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ao-day-date .material-symbols-rounded { font-size: 16px; color: var(--accent); flex-shrink: 0; }
  .ao-day-macrobar {
    display: flex; align-items: stretch; gap: 2px;
    height: 8px; flex: 0 1 120px; min-width: 54px;
    background: var(--surface-2);
    border-radius: var(--radius-full);
    overflow: hidden;
  }
  .ao-mb-seg { height: 100%; border-radius: var(--radius-full); }
  .ao-mb-seg.p { background: var(--macro-protein); }
  .ao-mb-seg.c { background: var(--macro-carbs); }
  .ao-mb-seg.f { background: var(--macro-fat); }
  .ao-mb-empty { flex: 1; height: 100%; background: var(--surface-3); }
  .ao-day-kcal {
    display: inline-flex; align-items: baseline; gap: 3px;
    margin-left: auto;
    font-size: 17px; font-weight: 700; color: var(--text-1);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .ao-day-kcal-unit { font-size: 10px; font-weight: 600; color: var(--text-3); }
  .ao-day-meta { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
  .ao-day-water { display: inline-flex; align-items: center; gap: 2px; font-size: 11px; color: var(--text-3); white-space: nowrap; }
  .ao-day-water .material-symbols-rounded { font-size: 14px; color: var(--info); }
  .ao-day-toggle {
    display: inline-flex; align-items: center; gap: 2px;
    background: none; border: none; cursor: pointer;
    font-family: inherit; font-size: 11px; font-weight: 600;
    color: var(--accent);
    padding: 3px 2px;
    border-radius: var(--radius-sm);
    white-space: nowrap;
  }
  .ao-day-toggle:hover { background: var(--accent-dim); }
  .ao-day-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .ao-day-chevron { font-size: 18px; transition: transform var(--dur-fast) var(--ease-out); }
  .ao-day-chevron.open { transform: rotate(180deg); }
  .ao-day-body {
    display: flex; flex-direction: column; gap: 8px;
    padding: 10px 12px 12px;
    border-top: 1px solid var(--border);
    min-width: 0;
  }
  .ao-day-totals { display: flex; flex-wrap: wrap; gap: 4px 10px; }
  .ao-macro { font-size: 11px; color: var(--text-3); white-space: nowrap; }
  .ao-macro b { color: var(--text-2); font-weight: 600; }
  .ao-macro.water b { color: var(--text-2); }
  .ao-macro-row { display: flex; flex-wrap: wrap; gap: 3px 9px; }

  .ao-items { display: flex; flex-direction: column; gap: 0; }
  .ao-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    align-items: baseline;
    gap: 2px 10px;
    padding: 5px 0;
    border-bottom: 1px solid var(--border);
    min-width: 0;
  }
  .ao-item:last-child { border-bottom: none; padding-bottom: 0; }
  .ao-item-name { font-size: 12px; font-weight: 500; color: var(--text-1); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ao-item-portion { font-size: 11px; color: var(--text-3); white-space: nowrap; }
  .ao-item-kcal { font-size: 12px; font-weight: 600; color: var(--text-2); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ao-item-kcal small { font-size: 9px; font-weight: 500; color: var(--text-3); }
  .ao-item-figs, .ao-figures { display: inline-flex; align-items: baseline; gap: 6px; white-space: nowrap; }
  .ao-fig { font-size: 10px; color: var(--text-3); font-variant-numeric: tabular-nums; }
  .ao-fig b { font-weight: 700; margin-right: 1px; }
  .ao-item-figs .ao-fig:nth-child(1) b,
  .ao-figures .ao-fig:nth-child(1) b { color: var(--macro-protein); }
  .ao-item-figs .ao-fig:nth-child(2) b,
  .ao-figures .ao-fig:nth-child(2) b { color: var(--macro-carbs); }
  .ao-item-figs .ao-fig:nth-child(3) b,
  .ao-figures .ao-fig:nth-child(3) b { color: var(--macro-fat); }
  .ao-chip { font-size: 10px; padding: 1px 7px; }
  .ao-empty-line { font-size: 12px; color: var(--text-3); margin: 2px 0; font-style: italic; }

  .ao-day-section { margin-top: 6px; }
  .ao-day-section-label {
    font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--text-3); margin-bottom: 4px;
  }
  .ao-pill-row { display: flex; flex-wrap: wrap; gap: 4px; }
  .ao-notes { font-size: 12px; color: var(--text-2); line-height: 1.45; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }

  /* Generic rows */
  .ao-rows { display: flex; flex-direction: column; }
  .ao-row {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
    padding: 11px 14px;
    border-bottom: 1px solid var(--border);
    min-width: 0;
  }
  .ao-row:last-child { border-bottom: none; }
  .ao-row-card { overflow: hidden; }
  .ao-row-card .ao-row { border-bottom: 1px solid var(--border); }
  .ao-row-card .ao-day-section { padding: 0 14px 12px; }
  .ao-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .ao-row-name { font-size: 13px; font-weight: 600; color: var(--text-1); overflow-wrap: anywhere; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .ao-row-sub { font-size: 11px; color: var(--text-3); overflow-wrap: anywhere; }
  .ao-row-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
  .ao-row-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0; max-width: 46%; }
  .ao-row-kcal { font-size: 13px; font-weight: 700; color: var(--accent); white-space: nowrap; }
  .ao-row-kcal small { font-size: 9px; font-weight: 500; color: var(--text-3); }
  .ao-meta-list { display: flex; flex-wrap: wrap; gap: 2px 10px; margin-top: 3px; }
  .ao-ingredients { display: flex; flex-direction: column; gap: 2px; }
  .ao-ingredient { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--text-2); }
  .ao-ingredient .ao-row-sub { flex-shrink: 0; }
  .ao-meal-details { margin-top: 4px; }
  .ao-meal-details summary {
    display: inline-flex; align-items: center; gap: 3px;
    list-style: none; cursor: pointer;
    font-size: 11px; color: var(--text-3);
    border-radius: var(--radius-sm);
  }
  .ao-meal-details summary::-webkit-details-marker { display: none; }
  .ao-meal-details summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .ao-meal-chevron { font-size: 16px; transition: transform var(--dur-fast) var(--ease-out); }
  .ao-meal-details[open] .ao-meal-chevron { transform: rotate(90deg); }
  .ao-meal-details[open] .ao-ingredients { margin-top: 4px; padding-left: 4px; }

  @media (max-width: 860px) {
    .ao-layout { grid-template-columns: minmax(0, 1fr); }
    .ao-user-list { max-height: 44vh; }
  }
  @media (max-width: 520px) {
    .ao-readonly-badge { display: none; }
    .ao-notice { align-items: flex-start; }
    .ao-row { flex-direction: column; gap: 6px; }
    .ao-row-right { align-items: flex-start; max-width: 100%; }
    .ao-day-date { flex: 1 1 100%; }
    .ao-day-macrobar { flex: 1 1 80px; min-width: 40px; }
    .ao-day-kcal { margin-left: 0; }
    .ao-day-meta { flex: 1 1 100%; justify-content: flex-start; }
    .ao-day-toggle { margin-left: auto; }
    .ao-rs-stats { gap: 12px; }
    .ao-rs-bars { flex-basis: 100%; }
    .ao-range-field { flex-basis: 100%; min-width: 0; }
    .ao-profile { padding: 12px; }
    .ao-count-grid { grid-template-columns: repeat(auto-fit, minmax(60px, 1fr)); }
    .ao-stat-label { font-size: 9px; }
  }
</style>
