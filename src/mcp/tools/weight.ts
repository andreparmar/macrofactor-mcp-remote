import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MacroFactorClient } from '../../lib/api/index.js';
import { z } from 'zod';

export function registerWeightTools(server: McpServer, client: MacroFactorClient): void {
  server.tool(
    'get_weight_entries',
    `Fetch bodyweight scale entries for a date range (YYYY-MM-DD) and return normalized weight history as JSON.`,
    {
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    },
    { readOnlyHint: true },
    async ({ startDate, endDate }) => {
      const entries = await client.getWeightEntries(startDate, endDate);
      return { content: [{ type: 'text' as const, text: JSON.stringify(entries, null, 2) }] };
    }
  );
}
