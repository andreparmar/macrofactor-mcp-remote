import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MacroFactorClient } from '../../lib/api/index.js';
import { z } from 'zod';

function todayDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function registerFoodTools(server: McpServer, client: MacroFactorClient): void {
  server.tool(
    'get_food_log',
    `Retrieve a day's food log entries as JSON, filtering out deleted items. Provide date as YYYY-MM-DD; defaults to today.`,
    {
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    },
    { readOnlyHint: true },
    async ({ date }) => {
      const entries = await client.getFoodLog(date ?? todayDate());
      const active = entries.filter((entry) => !entry.deleted);
      return { content: [{ type: 'text' as const, text: JSON.stringify(active, null, 2) }] };
    }
  );

  server.tool(
    'search_foods',
    `Search the MacroFactor food database by text query and return matching foods with serving options.`,
    { query: z.string().min(1) },
    { readOnlyHint: true },
    async ({ query }) => {
      const results = await client.searchFoods(query);
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    }
  );
}
