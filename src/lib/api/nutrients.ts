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
