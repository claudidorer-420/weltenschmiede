// Weltenschmiede – MCP-Server (Cloudflare Worker, Streamable HTTP, zustandslos).
// Anmeldung per OAuth 2.1 (PKCE + dynamische Client-Registrierung): Die Login-Seite fragt Name + Geheimwort
// wie die App ab. Token sind mit SEAL_SECRET versiegelt und enthalten das Firebase-Refresh-Token – der Server
// speichert nichts, und alle Zugriffe laufen mit dem Konto des Nutzers durch die Firestore-Regeln.
import { seal, unseal, sha256b64url } from './seal.js';
import { signInWithPassword, idTokenFor, Firestore } from './firestore.js';
import { TOOLS, INSTRUCTIONS, callTool } from './tools.js';

const VERSION = '1.0.0';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const ACCESS_TTL = 60 * 60 * 1000;
const CODE_TTL = 5 * 60 * 1000;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id',
};

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS, ...extra } });
const oauthError = (error, description, status = 400) => json({ error, error_description: description }, status);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function allowedRedirect(env, uri) {
  let u;
  try { u = new URL(uri); } catch { return false; }
  const hosts = String(env.ALLOWED_REDIRECT_HOSTS || 'claude.ai,claude.com,localhost,127.0.0.1').split(',').map((x) => x.trim()).filter(Boolean);
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return false;
  return hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

// ───────────────────────── OAuth-Metadaten ─────────────────────────
function resourceMetadata(origin) {
  return { resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ['weltenschmiede'], bearer_methods_supported: ['header'], resource_name: 'Weltenschmiede' };
}

function serverMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['weltenschmiede'],
  };
}

// Client-Registrierung ohne Speicher: die client_id ist die versiegelte Registrierung selbst.
async function register(req, env) {
  const body = await req.json().catch(() => null);
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length) return oauthError('invalid_redirect_uri', 'redirect_uris fehlt.');
  const bad = uris.find((u) => !allowedRedirect(env, u));
  if (bad) return oauthError('invalid_redirect_uri', `Weiterleitung nicht erlaubt: ${bad}`);
  const name = String(body.client_name || 'MCP-Client').slice(0, 80);
  const client_id = await seal(env.SEAL_SECRET, { typ: 'client', uris, name });
  return json({
    client_id, client_name: name, redirect_uris: uris, client_id_issued_at: Math.floor(Date.now() / 1000),
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
  }, 201);
}

function loginPage({ params, client, error = '', name = '' }) {
  const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource']
    .map((k) => `<input type="hidden" name="${k}" value="${esc(params.get(k) || '')}">`).join('');
  const host = (() => { try { return new URL(params.get('redirect_uri')).host; } catch { return '?'; } })();
  return new Response(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Weltenschmiede verbinden</title><style>
:root{color-scheme:light dark;--bg:#f5f1ea;--card:#fffdf9;--fg:#2a2420;--muted:#7a6f66;--line:#e2d8cc;--accent:#b8452f}
@media (prefers-color-scheme:dark){:root{--bg:#16130f;--card:#221d18;--fg:#efe7dc;--muted:#a79a8c;--line:#3a322a;--accent:#e0714f}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px}
main{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px}
h1{margin:0 0 4px;font-size:22px}p{margin:0 0 18px;color:var(--muted);font-size:14px}
label{display:block;font-size:14px;font-weight:600;margin:14px 0 6px}input[type=text],input[type=password]{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg);font-size:16px}
button{margin-top:22px;width:100%;padding:12px;border:0;border-radius:10px;background:var(--accent);color:#fff;font-size:16px;font-weight:600;cursor:pointer}
.err{background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent);padding:10px 12px;border-radius:10px;font-size:14px;margin-bottom:6px}
.who{font-size:13px;color:var(--muted);margin-top:16px;text-align:center}
</style></head><body><main>
<h1>⚒️ Weltenschmiede</h1>
<p><b>${esc(client.name)}</b> möchte mit deinem Konto auf deine Kampagnen zugreifen – lesen und ändern, mit denselben Rechten wie du in der App.</p>
${error ? `<div class="err">${esc(error)}</div>` : ''}
<form method="post" action="/authorize">${hidden}
<label for="n">Name</label><input id="n" name="name" type="text" autocomplete="username" required value="${esc(name)}" autofocus>
<label for="s">Geheimwort</label><input id="s" name="secret" type="password" autocomplete="current-password" required minlength="6">
<button type="submit">Zugriff erlauben</button></form>
<div class="who">Weiterleitung zu ${esc(host)}</div>
</main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'", 'referrer-policy': 'no-referrer' } });
}

async function authorize(req, env) {
  const params = req.method === 'POST' ? new URLSearchParams(await req.text()) : new URL(req.url).searchParams;
  const client = await unseal(env.SEAL_SECRET, params.get('client_id'), 'client');
  const redirect = params.get('redirect_uri') || client?.uris?.[0] || '';
  if (!client) return new Response('Unbekannter Client – bitte den Connector neu hinzufügen.', { status: 400 });
  if (!client.uris.includes(redirect)) return new Response('redirect_uri passt nicht zur Registrierung.', { status: 400 });
  params.set('redirect_uri', redirect);
  if (params.get('response_type') && params.get('response_type') !== 'code' && req.method === 'GET') return new Response('Nur response_type=code wird unterstützt.', { status: 400 });
  if (!params.get('code_challenge') || (params.get('code_challenge_method') || 'S256') !== 'S256') return new Response('PKCE (S256) ist erforderlich.', { status: 400 });

  if (req.method !== 'POST') return loginPage({ params, client });

  const name = String(params.get('name') || '').trim();
  let user;
  try {
    user = await signInWithPassword(env, name, String(params.get('secret') || ''));
  } catch (e) {
    return loginPage({ params, client, error: e.message, name });
  }
  const code = await seal(env.SEAL_SECRET, {
    typ: 'code', rt: user.refreshToken, uid: user.uid, name: user.name, cc: params.get('code_challenge'), ru: redirect, cid: params.get('client_id'), exp: Date.now() + CODE_TTL,
  });
  const to = new URL(redirect);
  to.searchParams.set('code', code);
  if (params.get('state')) to.searchParams.set('state', params.get('state'));
  return Response.redirect(to.toString(), 302);
}

async function issueTokens(env, { rt, uid, name }) {
  const access_token = await seal(env.SEAL_SECRET, { typ: 'at', rt, uid, name, exp: Date.now() + ACCESS_TTL });
  const refresh_token = await seal(env.SEAL_SECRET, { typ: 'rt', rt, uid, name });
  return json({ access_token, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token, scope: 'weltenschmiede' }, 200, { 'cache-control': 'no-store' });
}

async function token(req, env) {
  const ct = req.headers.get('content-type') || '';
  const p = ct.includes('application/json') ? new URLSearchParams(await req.json().catch(() => ({}))) : new URLSearchParams(await req.text());
  const grant = p.get('grant_type');
  if (grant === 'authorization_code') {
    const c = await unseal(env.SEAL_SECRET, p.get('code'), 'code');
    if (!c) return oauthError('invalid_grant', 'Code ungültig oder abgelaufen.');
    if (p.get('redirect_uri') && p.get('redirect_uri') !== c.ru) return oauthError('invalid_grant', 'redirect_uri passt nicht.');
    if (p.get('client_id') && p.get('client_id') !== c.cid) return oauthError('invalid_grant', 'client_id passt nicht.');
    if (!p.get('code_verifier') || (await sha256b64url(p.get('code_verifier'))) !== c.cc) return oauthError('invalid_grant', 'PKCE-Prüfung fehlgeschlagen.');
    return issueTokens(env, c);
  }
  if (grant === 'refresh_token') {
    const r = await unseal(env.SEAL_SECRET, p.get('refresh_token'), 'rt');
    if (!r) return oauthError('invalid_grant', 'Refresh-Token ungültig.');
    try {
      await idTokenFor(env, r.rt); // Konto noch gültig? (z. B. Geheimwort geändert)
    } catch {
      return oauthError('invalid_grant', 'Anmeldung abgelaufen – bitte neu verbinden.');
    }
    return issueTokens(env, r);
  }
  return oauthError('unsupported_grant_type', 'Nur authorization_code und refresh_token.');
}

// ───────────────────────── MCP ─────────────────────────
function unauthorized(origin, msg = 'Anmeldung erforderlich') {
  return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: msg } }, 401, {
    'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", error="invalid_token"`,
  });
}

async function handleRpc(msg, session) {
  const { id, method, params } = msg || {};
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return 'result' in (msg || {}) || 'error' in (msg || {}) ? null : fail(-32600, 'Ungültige Anfrage');
  const isNotification = id === undefined;
  try {
    switch (method) {
      case 'initialize': {
        const want = params?.protocolVersion;
        return reply({
          protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[1],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'weltenschmiede', title: 'Weltenschmiede', version: VERSION },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call': {
        const name = params?.name;
        if (!TOOLS.some((t) => t.name === name)) return fail(-32602, `Unbekanntes Werkzeug: ${name}`);
        try {
          const fs = await session.fs();
          const out = await callTool(fs, session.user, name, params.arguments || {});
          const text = typeof out === 'string' ? out : JSON.stringify(out, null, 1);
          return reply({ content: [{ type: 'text', text }] });
        } catch (e) {
          if (e.auth) throw e;
          return reply({ content: [{ type: 'text', text: `Fehler: ${e.message || e}` }], isError: true });
        }
      }
      default:
        if (isNotification || method.startsWith('notifications/')) return null;
        return fail(-32601, `Methode nicht unterstützt: ${method}`);
    }
  } catch (e) {
    if (e.auth) throw e;
    return fail(-32603, e.message || String(e));
  }
}

async function mcp(req, env, origin) {
  if (req.method === 'GET') return new Response('Dieser Server sendet keine Ereignisse per GET.', { status: 405, headers: { allow: 'POST', ...CORS } });
  if (req.method === 'DELETE') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST', ...CORS } });

  const auth = req.headers.get('authorization') || '';
  const tok = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  const at = tok ? await unseal(env.SEAL_SECRET, tok, 'at') : null;
  if (!at) return unauthorized(origin);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON-Fehler' } }, 400);
  }
  let fsInst = null;
  const session = {
    user: { uid: at.uid, name: at.name },
    fs: async () => (fsInst ||= new Firestore(env, await idTokenFor(env, at.rt))),
  };
  try {
    const batch = Array.isArray(body);
    const out = (await Promise.all((batch ? body : [body]).map((m) => handleRpc(m, session)))).filter(Boolean);
    if (!out.length) return new Response(null, { status: 202, headers: CORS });
    return json(batch ? out : out[0]);
  } catch (e) {
    if (e.auth) return unauthorized(origin, e.message);
    throw e;
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = env.PUBLIC_URL || url.origin;
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-max-age': '86400' } });
    try {
      const path = url.pathname.replace(/\/+$/, '') || '/';
      if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') return json(resourceMetadata(origin));
      if (path === '/.well-known/oauth-authorization-server' || path === '/.well-known/openid-configuration') return json(serverMetadata(origin));
      if (path === '/register' && req.method === 'POST') return register(req, env);
      if (path === '/authorize') return authorize(req, env);
      if (path === '/token' && req.method === 'POST') return token(req, env);
      if (path === '/mcp' || path === '/sse') return mcp(req, env, origin);
      if (path === '/') {
        return new Response(`Weltenschmiede MCP-Server ${VERSION}\n\nIn Claude als benutzerdefinierten Connector hinzufügen:\n  ${origin}/mcp\n\n${TOOLS.length} Werkzeuge: ${TOOLS.map((t) => t.name).join(', ')}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
      return new Response('Nicht gefunden', { status: 404, headers: CORS });
    } catch (e) {
      return json({ error: 'server_error', error_description: e.message || String(e) }, 500);
    }
  },
};
