/** Post a message to the Discord webhook in DISCORD_WEBHOOK_URL. No-op when unset; never throws. */
export async function notify(content: string): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'MacroFactor MCP', content }),
    });
    if (!resp.ok) console.error(`Discord webhook failed (${resp.status})`);
  } catch (err) {
    console.error('Discord webhook failed:', err instanceof Error ? err.message : String(err));
  }
}

/** Discord timestamp markup — renders in the reader's own timezone. */
export function discordTime(ms: number): string {
  return `<t:${Math.floor(ms / 1000)}:f>`;
}
