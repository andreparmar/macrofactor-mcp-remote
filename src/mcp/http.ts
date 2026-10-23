import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MacroFactorClient, RefreshTokenStore } from '../lib/api/index.js';
import { startAppCheckRefresher } from '../lib/api/appcheck.js';
import { setAppCheckToken } from '../lib/api/firestore.js';
import { COLOR, discordTime, notify } from '../lib/notify.js';
import { createServer as createMcpServer } from './server.js';
import {
  initOAuth,
  getOAuthMetadata,
  getProtectedResourceMetadata,
  validateBearerToken,
  handleRegister,
  handleAuthorizeGet,
  handleAuthorizePost,
  handleToken,
} from './oauth.js';

const MCP_PATH = '/mcp';

function getBaseUrl(): string {
  const raw = process.env.BASE_URL ?? '';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, Last-Event-ID, MCP-Protocol-Version');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  setCorsHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendJsonError(res: ServerResponse, statusCode: number, message: string): void {
  sendJson(res, statusCode, {
    jsonrpc: '2.0',
    error: { code: -32000, message },
    id: null,
  });
}

/** Expiry of an App Check JWT as Discord time markup, or "unknown" if it can't be decoded. */
function appCheckExpiry(token: string): string {
  try {
    const { exp } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { exp: number };
    return discordTime(exp * 1000);
  } catch {
    return 'unknown';
  }
}

function isInitializeRequest(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  return 'method' in body && body.method === 'initialize';
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const rawBody = Buffer.concat(chunks).toString('utf8').trim();
  if (!rawBody) return undefined;
  return JSON.parse(rawBody);
}

async function main() {
  const refreshToken = process.env.FIREBASE_REFRESH_TOKEN;
  const adminPassword = process.env.OAUTH_ADMIN_PASSWORD;
  const mfEmail = process.env.MACROFACTOR_USERNAME;
  const mfPassword = process.env.MACROFACTOR_PASSWORD;
  const tokenStorePath = process.env.REFRESH_TOKEN_STORE ?? '/data/mf-refresh-token';
  const port = Number(process.env.PORT ?? '3001');
  const baseUrl = getBaseUrl();

  const haveCredentials = Boolean(mfEmail && mfPassword);
  if (!refreshToken && !haveCredentials) {
    console.error(
      'Need either FIREBASE_REFRESH_TOKEN (npm run get-refresh-token) or ' +
        'MACROFACTOR_USERNAME + MACROFACTOR_PASSWORD for auto-login. Set in Railway env vars.'
    );
    process.exit(1);
  }

  if (!adminPassword) {
    console.error('OAUTH_ADMIN_PASSWORD is required. Set it in Railway env vars.');
    process.exit(1);
  }

  if (!baseUrl) {
    console.warn('BASE_URL not set — OAuth discovery will use request Host header (fine for Railway)');
  }

  initOAuth(adminPassword);

  // App Check IS enforced by MacroFactor on the Firestore reads this server uses (verified 2026-10-22:
  // users/{uid} and users/{uid}/food/* both 403 PERMISSION_DENIED with no App Check header). App Check =
  // Apple DeviceCheck attestation, which a server cannot mint — so a device_token captured from the iOS app
  // must be supplied. The refresher below trades that device_token for a fresh App Check token at startup and
  // every ~half its TTL. The device_token itself expires (~2 days); when it does, exchange fails and a Discord
  // alert fires asking for a new capture. Fallbacks if APPCHECK_DEVICE_TOKEN is unset: a static
  // FIREBASE_APP_CHECK_TOKEN, or a token pushed to /admin/app-check-token.
  const appCheckDeviceToken = process.env.APPCHECK_DEVICE_TOKEN;
  const firebaseApiKey = process.env.FIREBASE_WEB_API_KEY;
  if (appCheckDeviceToken && firebaseApiKey) {
    startAppCheckRefresher(appCheckDeviceToken, firebaseApiKey);
  } else if (process.env.FIREBASE_APP_CHECK_TOKEN) {
    console.log('Static FIREBASE_APP_CHECK_TOKEN set — it will be attached to MacroFactor requests.');
  } else {
    console.warn(
      'No App Check source: set APPCHECK_DEVICE_TOKEN (+ FIREBASE_WEB_API_KEY) for auto-refresh, or push a ' +
        'token to /admin/app-check-token. Firestore reads will 403 until one is provided.'
    );
  }
  const appCheckMode =
    appCheckDeviceToken && firebaseApiKey
      ? 'Device-token auto-refresh'
      : process.env.FIREBASE_APP_CHECK_TOKEN
        ? 'Static token'
        : '⚠️ None (reads will 403)';

  // Self-healing auth:
  //  Tier 1 — the Firebase refresh token rotates on every hourly refresh; we persist the latest to a
  //           Railway Volume (REFRESH_TOKEN_STORE) and prefer it over the env var on boot, so a rotated
  //           token survives container restarts (the real reason it used to "go stale" every few weeks).
  //  Tier 2 — if a token is ever fully revoked, re-login with MACROFACTOR_USERNAME/MACROFACTOR_PASSWORD
  //           to mint a brand-new one. Fully zero-touch.
  const tokenStore = new RefreshTokenStore(tokenStorePath);
  const storedToken = tokenStore.load();
  console.log(
    `Authenticating with MacroFactor ` +
      `(persisted token: ${storedToken ? 'yes' : 'no'}, env token: ${refreshToken ? 'yes' : 'no'}, ` +
      `auto-login: ${haveCredentials ? 'on' : 'off'})...`
  );
  const { client, via } = await MacroFactorClient.bootstrap({
    storedToken,
    envToken: refreshToken,
    auth: {
      email: mfEmail,
      password: mfPassword,
      onRefreshToken: (t) => tokenStore.save(t),
      // Self-heal alert: fires when a dead refresh token is recovered via credential re-login.
      onEvent: (e) => {
        if (e.kind === 'relogin') {
          void notify({
            title: '🔁 MacroFactor self-healed (re-login)',
            color: COLOR.warn,
            description:
              'The refresh token was rejected, so the server logged back in with stored credentials and minted a fresh one. No action needed.',
            fields: [
              { name: 'Trigger', value: (e.reason ?? 'unknown').slice(0, 300) },
              { name: 'New token valid', value: e.expiresAt ? discordTime(e.expiresAt, 'R') : '—', inline: true },
            ],
          });
        }
      },
    },
  });
  console.log('MacroFactor client ready.');

  const authLabel = via === 'login' ? 'Fresh login' : via === 'persisted' ? 'Persisted token' : 'Env token';

  // Status heartbeat: every HEARTBEAT_HOURS, keep the token warm and post a health line to Discord so the
  // webhook is an actual status feed (not just a one-time "started"). Reports token freshness; if a refresh
  // fails it will trigger Tier 2 re-login (which posts its own alert) or surface an error here.
  const HEARTBEAT_HOURS = Number(process.env.HEARTBEAT_HOURS ?? '12');
  if (HEARTBEAT_HOURS > 0) {
    const heartbeat = setInterval(
      () => {
        void (async () => {
          try {
            const expiry = await client.keepAlive();
            void notify({
              title: '💓 MacroFactor MCP — healthy',
              color: COLOR.ok,
              fields: [
                { name: 'Token valid', value: discordTime(expiry, 'R'), inline: true },
                { name: 'Auto-login', value: haveCredentials ? 'On' : 'Off', inline: true },
              ],
            });
          } catch (err) {
            void notify({
              title: '🔴 MacroFactor MCP — token refresh FAILED',
              color: COLOR.error,
              description:
                'Heartbeat could not refresh the session' +
                (haveCredentials ? ' even after re-login.' : ' and no credentials are set for auto-login.') +
                ' The MCP may be unable to read until this is fixed.',
              fields: [{ name: 'Error', value: (err instanceof Error ? err.message : String(err)).slice(0, 500) }],
            });
          }
        })();
      },
      HEARTBEAT_HOURS * 60 * 60 * 1000
    );
    heartbeat.unref();
  }

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req, res) => {
    setCorsHeaders(res);

    const host = req.headers.host ?? 'localhost';
    const proto = req.headers['x-forwarded-proto'] ?? 'https';
    const resolvedBaseUrl = baseUrl || `${proto}://${host}`;

    const url = new URL(req.url ?? '/', `http://${host}`);
    const pathname = url.pathname;

    // OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // ─── OAuth discovery ─────────────────────────────────────────────────────

    if (pathname === '/.well-known/oauth-protected-resource' && req.method === 'GET') {
      sendJson(res, 200, getProtectedResourceMetadata(resolvedBaseUrl));
      return;
    }

    if (pathname === '/.well-known/oauth-authorization-server' && req.method === 'GET') {
      sendJson(res, 200, getOAuthMetadata(resolvedBaseUrl));
      return;
    }

    // ─── OAuth endpoints ─────────────────────────────────────────────────────

    if (pathname === '/oauth/register') {
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST' }); res.end(); return;
      }
      handleRegister(req, res);
      return;
    }

    if (pathname === '/oauth/authorize') {
      if (req.method === 'GET') {
        handleAuthorizeGet(req, res);
        return;
      }
      if (req.method === 'POST') {
        await handleAuthorizePost(req, res, adminPassword);
        return;
      }
      res.writeHead(405, { Allow: 'GET, POST' }); res.end();
      return;
    }

    if (pathname === '/oauth/token') {
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST' }); res.end(); return;
      }
      await handleToken(req, res);
      return;
    }

    // ─── Admin: update App Check token in-memory (no redeploy needed) ────────

    if (pathname === '/admin/app-check-token' && req.method === 'POST') {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${adminPassword}`) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }
      const chunks: Uint8Array[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const rawBody = Buffer.concat(chunks).toString('utf8').trim();
      // Accept either {"token":"..."} JSON or plain-text token (from iOS Shortcut raw body)
      let t = '';
      if (rawBody.startsWith('{')) {
        try {
          const parsed = JSON.parse(rawBody) as { token?: string };
          t = (parsed.token ?? '').trim();
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON' });
          return;
        }
      } else {
        // strip a pasted "X-Firebase-AppCheck:" header name, then any whitespace/newlines
        t = rawBody.replace(/^x-firebase-appcheck\s*:/i, '').replace(/\s/g, '');
      }
      if (!t) { sendJson(res, 400, { error: 'Missing token' }); return; }
      setAppCheckToken(t);
      console.log(`App Check token updated: length=${t.length} start=${t.substring(0, 10)} end=${t.substring(t.length - 10)}`);
      void notify({
        title: '📲 App Check token pushed manually',
        color: COLOR.info,
        fields: [{ name: 'Valid until', value: appCheckExpiry(t), inline: true }],
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    // ─── Health check ─────────────────────────────────────────────────────────

    if (pathname === '/health' && req.method === 'GET') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    // ─── MCP endpoint ─────────────────────────────────────────────────────────

    if (pathname !== MCP_PATH) {
      res.writeHead(404); res.end('Not Found'); return;
    }

    if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
      res.writeHead(405, { Allow: 'GET,POST,DELETE,OPTIONS' }); res.end('Method Not Allowed'); return;
    }

    // Require valid OAuth bearer token
    if (!validateBearerToken(req.headers.authorization)) {
      res.setHeader('WWW-Authenticate', `Bearer realm="${resolvedBaseUrl}", error="invalid_token"`);
      sendJsonError(res, 401, 'Unauthorized: valid Bearer token required');
      return;
    }

    const sessionIdHeader = req.headers['mcp-session-id'];
    const sessionId = typeof sessionIdHeader === 'string' ? sessionIdHeader : undefined;

    try {
      if (req.method === 'DELETE') {
        if (sessionId) {
          const t = transports.get(sessionId);
          if (t) { await t.close(); transports.delete(sessionId); }
        }
        res.writeHead(204); res.end(); return;
      }

      if (req.method === 'GET') {
        if (!sessionId) { sendJsonError(res, 400, 'Mcp-Session-Id header required'); return; }
        const existing = transports.get(sessionId);
        if (!existing) { sendJsonError(res, 404, 'Session not found'); return; }
        await existing.handleRequest(req, res);
        return;
      }

      // POST
      const parsedBody = await readJsonBody(req);

      if (sessionId) {
        const existing = transports.get(sessionId);
        if (!existing) { sendJsonError(res, 404, 'Session not found'); return; }
        await existing.handleRequest(req, res, parsedBody);
        return;
      }

      if (!isInitializeRequest(parsedBody)) {
        sendJsonError(res, 400, 'No valid session ID provided');
        return;
      }

      let transport: StreamableHTTPServerTransport;
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => { transports.set(sid, transport); },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) transports.delete(sid);
      };

      const mcpServer = createMcpServer(client);
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('JSON')) { sendJsonError(res, 400, 'Invalid JSON body'); return; }
      if (!res.headersSent) sendJsonError(res, 500, 'Internal server error');
      console.error('Error handling request:', message);
    }
  });

  httpServer.listen(port, () => {
    console.log(`MCP server listening on port ${port}`);
    console.log(`  MCP endpoint:    ${resolvedBaseUrl || `http://localhost:${port}`}${MCP_PATH}`);
    console.log(`  OAuth discovery: ${resolvedBaseUrl || `http://localhost:${port}`}/.well-known/oauth-authorization-server`);
    void notify({
      title: '🟢 MacroFactor MCP server started',
      color: COLOR.ok,
      fields: [
        { name: 'Authed via', value: authLabel, inline: true },
        { name: 'Auto-login', value: haveCredentials ? 'On (self-healing)' : 'Off (token only)', inline: true },
        { name: 'Token valid', value: discordTime(client.getTokenExpiry(), 'R'), inline: true },
        { name: 'App Check', value: appCheckMode, inline: true },
        { name: 'Endpoint', value: `${resolvedBaseUrl}${MCP_PATH}` },
      ],
    });
  });

  // Compute resolvedBaseUrl for startup log outside the request handler
  const resolvedBaseUrl = baseUrl || `http://localhost:${port}`;
}

main().catch(async (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Fatal:', message);
  await notify({
    title: '🔴 MacroFactor MCP failed to start',
    color: COLOR.error,
    description: 'The server could not boot. Check the refresh token / credentials in Railway.',
    fields: [{ name: 'Error', value: message.slice(0, 1000) }],
  });
  process.exit(1);
});
