import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MacroFactorClient } from '../../lib/api/index.js';
import { searchExercises } from '../../lib/api/exercises.js';
import { z } from 'zod';

function todayDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function daysAgoDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function weekdayIndex(date: string): number {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const jsDay = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return (jsDay + 6) % 7;
}

function goalForDate(values: number[] | undefined, date: string): number {
  const source = values ?? [];
  return source[weekdayIndex(date)] ?? source[source.length - 1] ?? 0;
}

function summarizeLastMeal(entries: any[]) {
  const active = entries.filter((entry) => !entry.deleted && entry.hour != null && entry.minute != null);
  if (active.length === 0) return null;

  const mealTimes = active
    .map((entry) => `${String(entry.hour).padStart(2, '0')}:${String(entry.minute).padStart(2, '0')}`)
    .sort();
  const latestTime = mealTimes[mealTimes.length - 1];
  if (!latestTime) return null;

  const mealEntries = active.filter(
    (entry) => `${String(entry.hour).padStart(2, '0')}:${String(entry.minute).padStart(2, '0')}` === latestTime
  );

  return {
    time: latestTime,
    items: mealEntries.length,
    calories: Math.round(mealEntries.reduce((sum: number, entry: any) => sum + entry.calories(), 0)),
  };
}

function buildTodayContext(goals: any, entries: any[], date: string) {
  const active = entries.filter((entry: any) => !entry.deleted);
  const calories = Math.round(active.reduce((sum: number, entry: any) => sum + entry.calories(), 0));
  const protein = Math.round(active.reduce((sum: number, entry: any) => sum + entry.protein(), 0) * 10) / 10;
  const carbs = Math.round(active.reduce((sum: number, entry: any) => sum + entry.carbs(), 0) * 10) / 10;
  const fat = Math.round(active.reduce((sum: number, entry: any) => sum + entry.fat(), 0) * 10) / 10;

  const uniqueMeals = new Set(
    active
      .filter((entry: any) => entry.hour != null && entry.minute != null)
      .map((entry: any) => `${String(entry.hour).padStart(2, '0')}:${String(entry.minute).padStart(2, '0')}`)
  );

  return {
    logged: calories,
    protein,
    carbs,
    fat,
    meals: uniqueMeals.size,
    targets: {
      calories: goalForDate(goals?.calories, date),
      protein: goalForDate(goals?.protein, date),
      carbs: goalForDate(goals?.carbs, date),
      fat: goalForDate(goals?.fat, date),
    },
    remaining: goalForDate(goals?.calories, date) - calories,
  };
}

function buildRecentWeight(entries: Array<{ date: string; weight: number }>) {
  if (entries.length === 0) return { latest: null, trend7d: null };
  const latest = entries[entries.length - 1];
  const start = daysAgoDate(7);
  const window = entries.filter((entry) => entry.date >= start);
  const baseline = window[0] ?? latest;
  return {
    latest: latest.weight,
    trend7d: Math.round((latest.weight - baseline.weight) * 1000) / 1000,
  };
}

export function registerProfileTools(server: McpServer, client: MacroFactorClient): void {
  server.tool(
    'get_profile',
    `Retrieve the user's MacroFactor profile and account preferences as JSON.`,
    {},
    { readOnlyHint: true },
    async () => {
      const profile = await client.getProfile();
      return { content: [{ type: 'text' as const, text: JSON.stringify(profile, null, 2) }] };
    }
  );

  server.tool(
    'get_goals',
    `Retrieve the user's current macro and calorie targets (calories, protein, carbs, fat) configured in MacroFactor.`,
    {},
    { readOnlyHint: true },
    async () => {
      const goals = await client.getGoals();
      return { content: [{ type: 'text' as const, text: JSON.stringify(goals, null, 2) }] };
    }
  );

  server.tool(
    'get_gym_profiles',
    `List all gym profiles for the user including IDs, names, and equipment preferences.`,
    {},
    { readOnlyHint: true },
    async () => {
      const gyms = await client.getGymProfiles();
      return { content: [{ type: 'text' as const, text: JSON.stringify(gyms, null, 2) }] };
    }
  );

  server.tool(
    'get_custom_exercises',
    `Return the user's custom exercise definitions created in MacroFactor.`,
    {},
    { readOnlyHint: true },
    async () => {
      const customExercises = await client.getCustomExercises();
      return { content: [{ type: 'text' as const, text: JSON.stringify(customExercises, null, 2) }] };
    }
  );

  server.tool(
    'search_exercises',
    `Search the bundled MacroFactor exercise database by text query and return matching exercise records.`,
    { query: z.string().min(1) },
    { readOnlyHint: true },
    async ({ query }) => {
      const matches = searchExercises(query);
      return { content: [{ type: 'text' as const, text: JSON.stringify(matches, null, 2) }] };
    }
  );

  server.tool(
    'get_context',
    `Build a daily context snapshot combining goals, today's food log, recent weight trend, and upcoming training context in a single call.`,
    {},
    { readOnlyHint: true },
    async () => {
      const date = todayDate();
      const [goals, foodLog, weightEntries, programs, nextWorkout] = await Promise.all([
        client.getGoals(),
        client.getFoodLog(date),
        client.getWeightEntries(daysAgoDate(30), date),
        client.getTrainingPrograms(),
        client.getNextWorkout(),
      ]);

      const activeProgram = programs.find((program) => program.isActive) || programs[0] || null;
      const context = {
        goals,
        today: buildTodayContext(goals, foodLog, date),
        recentWeight: buildRecentWeight(weightEntries),
        program: activeProgram
          ? {
              name: activeProgram.name,
              nextDay: nextWorkout?.dayName ?? null,
              cycle: nextWorkout ? nextWorkout.cycleIndex + 1 : null,
            }
          : null,
        lastMeal: summarizeLastMeal(foodLog),
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(context, null, 2) }] };
    }
  );
}
