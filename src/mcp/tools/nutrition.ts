import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MacroFactorClient } from '../../lib/api/index.js';
import { z } from 'zod';

export function registerNutritionTools(server: McpServer, client: MacroFactorClient): void {
  server.tool(
    'get_nutrition',
    `Retrieve daily nutrition summaries for a date range and return the results as JSON. Use this when you need multi-day macro and calorie totals rather than individual food entries. Do not use this to inspect each logged food item or entry IDs, because get_food_log provides that lower-level detail. Prerequisite: provide startDate and endDate in YYYY-MM-DD format; see also get_goals for comparing against targets.`,
    {
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    },
    { readOnlyHint: true },
    async ({ startDate, endDate }) => {
      const nutrition = await client.getNutrition(startDate, endDate);
      return { content: [{ type: 'text' as const, text: JSON.stringify(nutrition, null, 2) }] };
    }
  );

  server.tool(
    'get_micronutrients',
    `Retrieve a single day's TOTAL micronutrients (fiber, sugar, sodium, potassium, calcium, iron, cholesterol, saturated fat, vitamins, etc.) plus macro totals, summed across every logged food entry. Use this when the user asks about nutrients beyond the four macros. Coverage depends on each food's source — USDA foods carry a full profile, branded/custom foods often only macros — so the result reflects whatever MacroFactor actually stored, not a complete RDA panel. Provide date as YYYY-MM-DD; defaults to today. For per-food detail use get_food_log; for multi-day macro totals use get_nutrition.`,
    {
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    },
    { readOnlyHint: true },
    async ({ date }) => {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const totals = await client.getMicronutrientTotals(date ?? todayStr);
      return { content: [{ type: 'text' as const, text: JSON.stringify(totals, null, 2) }] };
    }
  );

  server.tool(
    'get_steps',
    `Retrieve step-count entries for a date range and return them as JSON objects keyed by day. Use this when you need activity-volume context alongside nutrition or weight trend analysis. Do not use this to log or edit steps directly, because this server currently exposes read-only step access. Prerequisite: pass startDate and endDate as YYYY-MM-DD; related tools include get_nutrition and get_weight_entries for combined trend interpretation.`,
    {
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    },
    { readOnlyHint: true },
    async ({ startDate, endDate }) => {
      const steps = await client.getSteps(startDate, endDate);
      return { content: [{ type: 'text' as const, text: JSON.stringify(steps, null, 2) }] };
    }
  );
}
