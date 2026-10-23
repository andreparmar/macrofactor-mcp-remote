// MacroFactor stores per-food nutrients keyed by USDA FoodData Central nutrient
// numbers (same scheme as the 4 macros: 208=cal, 203=protein, 205=carbs, 204=fat).
// This maps the rest to friendly names + units so the read tools can surface them.
export const NUTRIENT_MAP: Record<string, { name: string; unit: string }> = {
  '269': { name: 'sugar', unit: 'g' },
  '291': { name: 'fiber', unit: 'g' },
  '601': { name: 'cholesterol', unit: 'mg' },
  '606': { name: 'saturatedFat', unit: 'g' },
  '605': { name: 'transFat', unit: 'g' },
  '645': { name: 'monounsaturatedFat', unit: 'g' },
  '646': { name: 'polyunsaturatedFat', unit: 'g' },
  '307': { name: 'sodium', unit: 'mg' },
  '306': { name: 'potassium', unit: 'mg' },
  '301': { name: 'calcium', unit: 'mg' },
  '303': { name: 'iron', unit: 'mg' },
  '304': { name: 'magnesium', unit: 'mg' },
  '305': { name: 'phosphorus', unit: 'mg' },
  '309': { name: 'zinc', unit: 'mg' },
  '312': { name: 'copper', unit: 'mg' },
  '315': { name: 'manganese', unit: 'mg' },
  '317': { name: 'selenium', unit: 'mcg' },
  '318': { name: 'vitaminA_IU', unit: 'IU' },
  '320': { name: 'vitaminA_RAE', unit: 'mcg' },
  '401': { name: 'vitaminC', unit: 'mg' },
  '404': { name: 'thiamin_B1', unit: 'mg' },
  '405': { name: 'riboflavin_B2', unit: 'mg' },
  '406': { name: 'niacin_B3', unit: 'mg' },
  '410': { name: 'pantothenicAcid_B5', unit: 'mg' },
  '415': { name: 'vitaminB6', unit: 'mg' },
  '417': { name: 'folate', unit: 'mcg' },
  '418': { name: 'vitaminB12', unit: 'mcg' },
  '421': { name: 'choline', unit: 'mg' },
  '323': { name: 'vitaminE', unit: 'mg' },
  '328': { name: 'vitaminD', unit: 'mcg' },
  '430': { name: 'vitaminK', unit: 'mcg' },
  '221': { name: 'alcohol', unit: 'g' },
  '255': { name: 'water', unit: 'g' },
  '262': { name: 'caffeine', unit: 'mg' },
};

// Field keys that are NOT nutrients (entry metadata) — skip when collecting nutrient ids.
const NON_NUTRIENT_KEYS = new Set([
  't', 'b', 'id', 'c', 'p', 'e', 'f', 'g', 'w', 'y', 'q', 's', 'u', 'h', 'mi',
  'k', 'x', 'ca', 'ua', 'o', 'fav', 'ef', 'm', 'd', 'n', 'r',
]);

/** Pull the per-serving nutrient-id fields out of a raw food-entry document. */
export function collectNutrientFields(val: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(val)) {
    if (NON_NUTRIENT_KEYS.has(key)) continue;
    if (!/^\d+(\.\d+)?$/.test(key)) continue; // nutrient ids are numeric
    const n = Number(raw);
    if (Number.isFinite(n) && n !== 0) out[key] = n;
  }
  return out;
}

/** A single named, scaled nutrient amount. */
export interface NamedNutrient {
  name: string;
  amount: number;
  unit: string;
}

/** Map per-serving nutrient ids → named amounts, scaled by a serving multiplier. Unknown ids are dropped. */
export function namedNutrients(
  perServingById: Record<string, number> | undefined,
  multiplier: number
): NamedNutrient[] {
  if (!perServingById) return [];
  const out: NamedNutrient[] = [];
  for (const [id, perServing] of Object.entries(perServingById)) {
    const meta = NUTRIENT_MAP[id];
    if (!meta) continue;
    out.push({ name: meta.name, amount: round(perServing * multiplier), unit: meta.unit });
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// General Dietary Reference Intakes (adult 19–50). MacroFactor sets NO micronutrient goals, so these are
// standard NIH/FDA references — a sanity gauge, not personalized medical targets. type 'min' = aim to reach;
// 'limit' = try to stay under. Values differ by sex where the DRI does.
interface RefTarget { male: number; female: number; unit: string; type: 'min' | 'limit' }
export const REFERENCE_TARGETS: Record<string, RefTarget> = {
  fiber: { male: 38, female: 25, unit: 'g', type: 'min' },
  sugar: { male: 50, female: 50, unit: 'g', type: 'limit' }, // FDA DV, total; added-sugar guidance is lower
  saturatedFat: { male: 20, female: 20, unit: 'g', type: 'limit' },
  transFat: { male: 2, female: 2, unit: 'g', type: 'limit' },
  cholesterol: { male: 300, female: 300, unit: 'mg', type: 'limit' },
  sodium: { male: 2300, female: 2300, unit: 'mg', type: 'limit' },
  potassium: { male: 3400, female: 2600, unit: 'mg', type: 'min' },
  calcium: { male: 1000, female: 1000, unit: 'mg', type: 'min' },
  iron: { male: 8, female: 18, unit: 'mg', type: 'min' },
  magnesium: { male: 400, female: 310, unit: 'mg', type: 'min' },
  phosphorus: { male: 700, female: 700, unit: 'mg', type: 'min' },
  zinc: { male: 11, female: 8, unit: 'mg', type: 'min' },
  copper: { male: 0.9, female: 0.9, unit: 'mg', type: 'min' },
  manganese: { male: 2.3, female: 1.8, unit: 'mg', type: 'min' },
  selenium: { male: 55, female: 55, unit: 'mcg', type: 'min' },
  vitaminA_RAE: { male: 900, female: 700, unit: 'mcg', type: 'min' },
  vitaminC: { male: 90, female: 75, unit: 'mg', type: 'min' },
  vitaminD: { male: 15, female: 15, unit: 'mcg', type: 'min' },
  vitaminE: { male: 15, female: 15, unit: 'mg', type: 'min' },
  vitaminK: { male: 120, female: 90, unit: 'mcg', type: 'min' },
  thiamin_B1: { male: 1.2, female: 1.1, unit: 'mg', type: 'min' },
  riboflavin_B2: { male: 1.3, female: 1.1, unit: 'mg', type: 'min' },
  niacin_B3: { male: 16, female: 14, unit: 'mg', type: 'min' },
  pantothenicAcid_B5: { male: 5, female: 5, unit: 'mg', type: 'min' },
  vitaminB6: { male: 1.3, female: 1.3, unit: 'mg', type: 'min' },
  folate: { male: 400, female: 400, unit: 'mcg', type: 'min' },
  vitaminB12: { male: 2.4, female: 2.4, unit: 'mcg', type: 'min' },
  choline: { male: 550, female: 425, unit: 'mg', type: 'min' },
};

/** DRI target for a nutrient given sex ('M'/'F' etc.), or undefined if none is defined. */
export function targetFor(
  name: string,
  sex: string | undefined
): { target: number; targetType: 'min' | 'limit' } | undefined {
  const t = REFERENCE_TARGETS[name];
  if (!t) return undefined;
  const female = (sex ?? '').toUpperCase().startsWith('F');
  return { target: female ? t.female : t.male, targetType: t.type };
}
