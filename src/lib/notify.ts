export const COLOR = {
  ok: 0x2ecc71,
  warn: 0xf39c12,
  error: 0xe74c3c,
  info: 0x3498db,
} as const;

export interface Notice {
  title: string;
  color: number;
  description?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
}

/** Post an embed to the Discord webhook in DISCORD_WEBHOOK_URL. No-op when unset; never throws. */
export async function notify(notice: Notice): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'MacroFactor MCP',
        embeds: [{ ...notice, timestamp: new Date().toISOString(), footer: { text: 'macrofactor-mcp-remote' } }],
      }),
    });
    if (!resp.ok) console.error(`Discord webhook failed (${resp.status})`);
  } catch (err) {
    console.error('Discord webhook failed:', err instanceof Error ? err.message : String(err));
  }
}

/** Discord timestamp markup — renders in the reader's own timezone. style f = full date, R = relative. */
export function discordTime(ms: number, style: 'f' | 'R' = 'f'): string {
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}
