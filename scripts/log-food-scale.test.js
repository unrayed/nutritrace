/**
 * Regression: log_food portion/unit overrides must rescale the stored
 * nutrition. Diary totals are `nutrition × quantity` and `portion` is
 * display-only, so storing a food's baseline per-portion values under an
 * override label produced "1 tbsp olive oil = 822 kcal" while the tool
 * reply claimed 8 kcal.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLoggedItem } from '../src/lib/log-food-scale.js';

const oliveOil = {
  id: 2, name: 'Olive oil', brand: 'solesta',
  portion: 100, unit: 'g',
  nutrition: { calories: 822, fat: 91, proteins: 0.5, carbohydrates: 0.5 },
};

test('no override keeps the food baseline untouched', () => {
  const item = buildLoggedItem(oliveOil, { quantity: 1 });
  assert.equal(item.portion, 100);
  assert.equal(item.unit, 'g');
  assert.equal(item.quantity, 1);
  assert.equal(item.nutrition.calories, 822);
});

test('gram override rescales nutrition to the consumed amount', () => {
  const item = buildLoggedItem(oliveOil, { portionOverride: 14, quantity: 1 });
  assert.equal(item.portion, 14);
  assert.equal(item.unit, 'g');
  assert.equal(item.nutrition.calories, 115.08);
  assert.equal(item.nutrition.fat, 12.74);
  // The diary total is nutrition × quantity — never the baseline 822.
  assert.equal(item.nutrition.calories * item.quantity, 115.08);
});

test('override doubles when the portion doubles', () => {
  const item = buildLoggedItem(oliveOil, { portionOverride: 200, quantity: 1 });
  assert.equal(item.nutrition.calories, 1644);
});

test('quantity multiplies the already-scaled nutrition', () => {
  const item = buildLoggedItem(oliveOil, { portionOverride: 14, quantity: 2 });
  assert.equal(item.nutrition.calories, 115.08);
  assert.equal(item.nutrition.calories * item.quantity, 230.16);
});

test('cross-unit override is refused instead of treated as grams', () => {
  assert.throws(
    () => buildLoggedItem(oliveOil, { portionOverride: 1, unitOverride: 'tbsp' }),
    /Unit mismatch/
  );
});

test('alt-unit foods refuse a numeric override', () => {
  const food = { ...oliveOil, alt_units: [{ unit: 'tbsp', grams: 14 }] };
  assert.throws(
    () => buildLoggedItem(food, { portionOverride: 14 }),
    /alt-units/
  );
});

test('a food without a baseline portion refuses a numeric override', () => {
  const food = { ...oliveOil, portion: null };
  assert.throws(
    () => buildLoggedItem(food, { portionOverride: 14 }),
    /no baseline portion/
  );
});
