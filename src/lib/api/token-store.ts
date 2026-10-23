import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Persists the Firebase refresh token to disk so a rotating token survives
 * container restarts (Railway redeploys, crashes, platform maintenance).
 *
 * On Railway, point REFRESH_TOKEN_STORE at a path inside an attached Volume
 * (default `/data/mf-refresh-token`). With no Volume the save simply no-ops
 * with a one-time warning — the server still runs off the env var, it just
 * can't remember a rotated token across restarts.
 */
export class RefreshTokenStore {
  private warned = false;

  constructor(private readonly path: string) {}

  /** The persisted token, or undefined if none / unreadable. */
  load(): string | undefined {
    try {
      const t = readFileSync(this.path, 'utf8').trim();
      return t || undefined;
    } catch {
      return undefined;
    }
  }

  /** Persist the token; warns once (never throws) if the path isn't writable. */
  save(token: string): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, token, { mode: 0o600 });
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `⚠️  Could not persist refresh token to ${this.path} (${msg}). ` +
            'Token rotation will NOT survive restarts — attach a Railway Volume ' +
            'and set REFRESH_TOKEN_STORE to a path inside it to enable this.'
        );
      }
    }
  }
}
