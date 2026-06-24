import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MacroFactorClient } from '../../lib/api/index.js';
import { z } from 'zod';

export function registerWorkoutTools(server: McpServer, client: MacroFactorClient): void {
  server.tool(
    'get_workouts',
    `List workout history entries, optionally filtered by start-time range (ISO strings). Returns a summary index; use get_workout for full set-by-set detail.`,
    {
      from: z.string().optional(),
      to: z.string().optional(),
    },
    { readOnlyHint: true },
    async ({ from, to }) => {
      let workouts = await client.getWorkoutHistory();
      if (from) workouts = workouts.filter((w) => w.startTime >= from);
      if (to) workouts = workouts.filter((w) => w.startTime <= to);
      return { content: [{ type: 'text' as const, text: JSON.stringify(workouts, null, 2) }] };
    }
  );

  server.tool(
    'get_workout',
    `Fetch full detail for a single workout ID, including all blocks, exercises, and set logs.`,
    { id: z.string().min(1) },
    { readOnlyHint: true },
    async ({ id }) => {
      const workout = await client.getWorkout(id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(workout, null, 2) }] };
    }
  );

  server.tool(
    'get_training_program',
    `Return the active training program definition (or the first available), including cycle metadata and day structure.`,
    {},
    { readOnlyHint: true },
    async () => {
      const programs = await client.getTrainingPrograms();
      const active = programs.find((program) => program.isActive) || programs[0] || null;
      return { content: [{ type: 'text' as const, text: JSON.stringify(active, null, 2) }] };
    }
  );

  server.tool(
    'get_training_programs',
    `List all training programs in the user's library with id, name, cycle count, periodization, and isActive flag.`,
    {},
    { readOnlyHint: true },
    async () => {
      const programs = await client.getTrainingPrograms();
      const summary = programs.map((p) => ({
        id: p.id,
        name: p.name,
        numCycles: p.numCycles,
        isPeriodized: p.isPeriodized,
        deload: p.deload,
        isActive: p.isActive,
        dayCount: p.days.length,
        workoutDays: p.days.filter((d) => !d.isRestDay).length,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
    }
  );

  server.tool(
    'get_next_workout',
    `Return the computed next workout day in the active training cycle, including day name and exercise references.`,
    {},
    { readOnlyHint: true },
    async () => {
      const next = await client.getNextWorkout();
      return { content: [{ type: 'text' as const, text: JSON.stringify(next, null, 2) }] };
    }
  );

  server.tool(
    'get_custom_workouts',
    `List all custom workouts in the user's library (queued/planned sessions). Returns id, name, gym, and block/exercise counts.`,
    {},
    { readOnlyHint: true },
    async () => {
      const customWorkouts = await client.getCustomWorkouts();
      const summary = customWorkouts.map((cw) => ({
        id: cw.id,
        name: cw.workoutPlan.name,
        gymId: cw.workoutPlan.gymId,
        blockCount: cw.workoutPlan.blocks.length,
        exerciseCount: cw.workoutPlan.blocks.reduce((sum, b) => sum + b.exercises.length, 0),
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
    }
  );

  server.tool(
    'get_custom_workout',
    `Fetch a single custom workout plan by id, including all blocks, exercises, set targets, and exercise names.`,
    { id: z.string().min(1) },
    { readOnlyHint: true },
    async ({ id }) => {
      const customWorkout = await client.getCustomWorkout(id);
      if (!customWorkout) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'not_found', id }, null, 2) }] };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(customWorkout, null, 2) }] };
    }
  );
}
