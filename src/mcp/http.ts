import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MacroFactorClient } from '../lib/api/index.js';
import { setAppCheckToken } from '../lib/api/firestore.js';
import { createServer as createMcpServer } from './server.js';
import {
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
  const port = Number(process.env.PORT ?? '3001');
  const baseUrl = getBaseUrl();

  if (!refreshToken) {
    console.error('FIREBASE_REFRESH_TOKEN is required. Run: npm run get-refresh-token');
    process.exit(1);
  }

  if (!adminPassword) {
    console.error('OAUTH_ADMIN_PASSWORD is required. Set it in Railway env vars.');
    process.exit(1);
  }

  if (!baseUrl) {
    console.warn('BASE_URL not set — OAuth discovery will use request Host header (fine for Railway)');
  }

  console.log('Authenticating with MacroFactor via refresh token...');
  const client = await MacroFactorClient.fromRefreshToken(refreshToken);
  console.log('MacroFactor client ready.');

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
      try {
        const body = await readJsonBody(req) as { token?: string };
        if (!body?.token) { sendJson(res, 400, { error: 'Missing token' }); return; }
        setAppCheckToken(body.token);
        console.log('App Check token updated via admin endpoint');
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON' });
      }
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
  });

  // Compute resolvedBaseUrl for startup log outside the request handler
  const resolvedBaseUrl = baseUrl || `http://localhost:${port}`;
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Fatal:', message);
  process.exit(1);
});
