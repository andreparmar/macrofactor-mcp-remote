import { randomUUID, createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

type RegisteredClient = {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
};

type PendingCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: number;
};

type StoredToken = {
  expiresAt: number;
};

const clients = new Map<string, RegisteredClient>();
const codes = new Map<string, PendingCode>();
const tokens = new Map<string, StoredToken>();

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export function getOAuthMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  };
}

export function getProtectedResourceMetadata(baseUrl: string) {
  return {
    resource: baseUrl,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ['header'],
  };
}

export function validateBearerToken(authHeader: string | undefined): boolean {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.substring(7);
  const entry = tokens.get(token);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    tokens.delete(token);
    return false;
  }
  return true;
}

function verifyPkce(codeVerifier: string, codeChallenge: string, method: string): boolean {
  if (method === 'S256') {
    const computed = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    return computed === codeChallenge;
  }
  // plain (not recommended, but fallback)
  return codeVerifier === codeChallenge;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(json);
}

async function readBody(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};

  const contentType = req.headers['content-type'] ?? '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }

  // application/x-www-form-urlencoded
  const params = new URLSearchParams(raw);
  const out: Record<string, string> = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

export function handleRegister(req: IncomingMessage, res: ServerResponse): void {
  let bodyRaw = '';
  req.on('data', (chunk: Buffer) => { bodyRaw += chunk.toString(); });
  req.on('end', () => {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(bodyRaw);
    } catch {
      // ignore parse errors
    }

    const clientId = randomUUID();
    const redirectUris = Array.isArray(body.redirect_uris) ? (body.redirect_uris as string[]) : [];
    const client: RegisteredClient = {
      clientId,
      redirectUris,
      clientName: typeof body.client_name === 'string' ? body.client_name : undefined,
    };
    clients.set(clientId, client);

    sendJson(res, 201, {
      client_id: clientId,
      redirect_uris: redirectUris,
      client_name: client.clientName,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });
  });
}

const AUTHORIZE_HTML = (params: {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  error?: string;
}) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MacroFactor MCP — Authorize</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e0e0e0; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
  .card { background: #1a1d27; border: 1px solid #2d3146; border-radius: 12px; padding: 2rem; width: 100%; max-width: 380px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; color: #fff; }
  p { font-size: 0.875rem; color: #9ca3af; margin: 0 0 1.5rem; }
  label { display: block; font-size: 0.8125rem; font-weight: 500; color: #d1d5db; margin-bottom: 0.4rem; }
  input[type=password] { width: 100%; box-sizing: border-box; padding: 0.6rem 0.75rem; background: #0f1117; border: 1px solid #374151; border-radius: 6px; color: #f9fafb; font-size: 1rem; outline: none; }
  input[type=password]:focus { border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,0.25); }
  button { margin-top: 1rem; width: 100%; padding: 0.65rem; background: #4f46e5; color: #fff; border: none; border-radius: 6px; font-size: 0.9375rem; font-weight: 500; cursor: pointer; }
  button:hover { background: #4338ca; }
  .error { background: #3f1515; border: 1px solid #7f1d1d; border-radius: 6px; padding: 0.6rem 0.75rem; margin-bottom: 1rem; font-size: 0.875rem; color: #fca5a5; }
</style>
</head>
<body>
<div class="card">
  <h1>Authorize MacroFactor MCP</h1>
  <p>Enter the admin password to grant Claude access to your MacroFactor data.</p>
  ${params.error ? `<div class="error">${params.error}</div>` : ''}
  <form method="POST" action="/oauth/authorize">
    <input type="hidden" name="client_id" value="${escHtml(params.client_id)}">
    <input type="hidden" name="redirect_uri" value="${escHtml(params.redirect_uri)}">
    <input type="hidden" name="state" value="${escHtml(params.state)}">
    <input type="hidden" name="code_challenge" value="${escHtml(params.code_challenge)}">
    <input type="hidden" name="code_challenge_method" value="${escHtml(params.code_challenge_method)}">
    <label for="password">Admin password</label>
    <input type="password" id="password" name="password" autofocus autocomplete="current-password">
    <button type="submit">Authorize</button>
  </form>
</div>
</body>
</html>`;

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function handleAuthorizeGet(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', `http://localhost`);
  const clientId = url.searchParams.get('client_id') ?? '';
  const redirectUri = url.searchParams.get('redirect_uri') ?? '';
  const state = url.searchParams.get('state') ?? '';
  const codeChallenge = url.searchParams.get('code_challenge') ?? '';
  const codeChallengeMethod = url.searchParams.get('code_challenge_method') ?? 'S256';

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(AUTHORIZE_HTML({ client_id: clientId, redirect_uri: redirectUri, state, code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod }));
}

export async function handleAuthorizePost(req: IncomingMessage, res: ServerResponse, adminPassword: string): Promise<void> {
  const body = await readBody(req);

  const clientId = body.client_id ?? '';
  const redirectUri = body.redirect_uri ?? '';
  const state = body.state ?? '';
  const codeChallenge = body.code_challenge ?? '';
  const codeChallengeMethod = body.code_challenge_method ?? 'S256';
  const password = body.password ?? '';

  if (password !== adminPassword) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(AUTHORIZE_HTML({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      error: 'Incorrect password. Please try again.',
    }));
    return;
  }

  const code = randomUUID();
  codes.set(code, {
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    expiresAt: Date.now() + CODE_TTL_MS,
  });

  const callback = new URL(redirectUri);
  callback.searchParams.set('code', code);
  callback.searchParams.set('state', state);

  res.writeHead(302, { Location: callback.toString() });
  res.end();
}

export async function handleToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);

  const grantType = body.grant_type;
  if (grantType !== 'authorization_code') {
    sendJson(res, 400, { error: 'unsupported_grant_type' });
    return;
  }

  const code = body.code;
  const codeVerifier = body.code_verifier ?? '';
  const redirectUri = body.redirect_uri ?? '';

  if (!code) {
    sendJson(res, 400, { error: 'invalid_request', error_description: 'Missing code' });
    return;
  }

  const pending = codes.get(code);
  if (!pending) {
    sendJson(res, 400, { error: 'invalid_grant', error_description: 'Code not found or expired' });
    return;
  }
  codes.delete(code);

  if (Date.now() > pending.expiresAt) {
    sendJson(res, 400, { error: 'invalid_grant', error_description: 'Code expired' });
    return;
  }

  if (pending.redirectUri !== redirectUri) {
    sendJson(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    return;
  }

  if (!verifyPkce(codeVerifier, pending.codeChallenge, pending.codeChallengeMethod)) {
    sendJson(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
    return;
  }

  const accessToken = randomUUID();
  tokens.set(accessToken, { expiresAt: Date.now() + TOKEN_TTL_MS });

  sendJson(res, 200, {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_MS / 1000,
    scope: 'mcp',
  });
}
