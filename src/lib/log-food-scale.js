/**
 * Build a diary item whose stored nutrition is already scaled to the
 * consumed portion.
 *
 * Diary totals are `nutrition × quantity` and `portion` is display-only
 * (see src/lib/nutrition.js). A food row stores nutrition PER its own
 * `portion`, so when the AI supplies a portion/unit override we must
 * rescale nutrition to that override here. Skipping the rescale stores the
 * food's baseline per-portion values under the override label — the bug
 * behind "1 tbsp olive oil = 822 kcal".
 *
 * Cross-unit overrides are refused rather than silently treated as the
 * food's base unit (tbsp is not grams).
 */
export function foodAltUnits(food) {
  if (Array.isArray(food?.alt_units)) return food.alt_units;
  if (typeof food?.alt_units === 'string' && food.alt_units.trim()) {
    try {
      const a = JSON.parse(food.alt_units);
      return Array.isArray(a) ? a : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function buildLoggedItem(food, { portionOverride, unitOverride, quantity } = {}) {
  const basePortion = Number(food.portion);
  const hasBase = Number.isFinite(basePortion) && basePortion > 0;
  const baseUnit = (food.unit || 'g').trim();
  const effUnit = (unitOverride || baseUnit || 'g').trim();
  if (unitOverride && baseUnit && effUnit.toLowerCase() !== baseUnit.toLowerCase()) {
    throw new Error(
      `Unit mismatch: "${food.name}" is stored in ${baseUnit}, but ${effUnit} was requested. ` +
      `Convert the amount to ${baseUnit} and retry (e.g. 1 tbsp olive oil ≈ 14 g).`
    );
  }
  const hasOverride = Number.isFinite(portionOverride) && portionOverride > 0;
  if (hasOverride && foodAltUnits(food)) {
    throw new Error(
      `"${food.name}" uses custom alt-units, so a numeric portion override can't be scaled safely. ` +
      `Log it without a portion, or edit the food's serving in Foods.`
    );
  }
  if (hasOverride && !hasBase) {
    throw new Error(
      `"${food.name}" has no baseline portion, so a portion override can't be scaled. ` +
      `Log it without a portion.`
    );
  }
  const effPortion = hasOverride ? portionOverride : (hasBase ? basePortion : null);
  const factor = (hasOverride && hasBase) ? (effPortion / basePortion) : 1;
  const nutrition = {};
  for (const [k, v] of Object.entries(food.nutrition || {})) {
    nutrition[k] = (k === '_derived' || typeof v !== 'number')
      ? v
      : Math.round(v * factor * 100) / 100;
  }
  return {
    ...food,
    portion: effPortion ?? undefined,
    unit: effUnit,
    quantity,
    nutrition,
  };
}
