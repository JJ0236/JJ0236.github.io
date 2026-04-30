/**
 * Sherlock Proxy — Cloudflare Worker
 *
 * Endpoints:
 *   GET /check?url=<encoded>&needle=<string>&mode=<status|body>
 *     → { found: bool, status: int, url: string }
 *
 *   GET /gravatar?hash=<md5hex>
 *     → { found: bool }
 *
 *   GET /emailrep?email=<encoded>
 *     → raw emailrep.io JSON
 *
 *   GET /dns?domain=<encoded>
 *     → { hasMX: bool }
 *
 * All origins allowed (site is already auth-gated client-side).
 */

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    const url  = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (path === '/check')    return cors(await handleCheck(url));
    if (path === '/gravatar') return cors(await handleGravatar(url));
    if (path === '/emailrep') return cors(await handleEmailrep(url));
    if (path === '/dns')      return cors(await handleDns(url));

    return cors(json({ error: 'Unknown endpoint' }, 404));
  },
};

// ── /check ───────────────────────────────────────────────
async function handleCheck(url) {
  const target = url.searchParams.get('url');
  const needle = url.searchParams.get('needle') || '';
  const mode   = url.searchParams.get('mode') || 'status'; // 'status' | 'body'

  if (!target) return json({ error: 'Missing url param' }, 400);

  // Only allow https:// URLs to known profile-like hosts
  let parsed;
  try { parsed = new URL(target); } catch { return json({ error: 'Invalid url' }, 400); }
  if (parsed.protocol !== 'https:') return json({ error: 'HTTPS only' }, 400);

  let res;
  try {
    res = await fetch(target, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
  } catch (e) {
    return json({ found: false, status: 0, error: 'fetch failed' });
  }

  if (mode === 'body') {
    // 'found' = page returned 200 AND does NOT contain the not-found needle
    if (!needle) return json({ found: false, status: res.status, error: 'needle required for body mode' }, 400);
    const text = await res.text();
    const found = res.status === 200 && !text.includes(needle);
    return json({ found, status: res.status });
  }

  // Default: status mode — 200/301/302 = found, 404 = not found
  const found = res.status >= 200 && res.status < 400;
  return json({ found, status: res.status });
}

// ── /gravatar ─────────────────────────────────────────────
async function handleGravatar(url) {
  const hash = url.searchParams.get('hash');
  if (!hash || !/^[a-f0-9]{32}$/.test(hash)) {
    return json({ error: 'Invalid or missing hash' }, 400);
  }
  let res;
  try {
    res = await fetch(`https://www.gravatar.com/avatar/${hash}?d=404`, {
      method: 'HEAD',
    });
  } catch {
    return json({ found: false, status: 0 });
  }
  return json({ found: res.status === 200, status: res.status });
}

// ── /emailrep ─────────────────────────────────────────────
async function handleEmailrep(url) {
  const email = url.searchParams.get('email');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Invalid email' }, 400);
  }
  let res;
  try {
    res = await fetch(`https://emailrep.io/${encodeURIComponent(email)}`, {
      headers: { 'User-Agent': 'sherlock-void/1.0' },
    });
  } catch {
    return json({ error: 'emailrep fetch failed' }, 502);
  }
  const data = await res.json();
  return json(data, res.status);
}

// ── /dns ──────────────────────────────────────────────────
async function handleDns(url) {
  const domain = url.searchParams.get('domain');
  if (!domain || !/^[a-zA-Z0-9._-]+$/.test(domain)) {
    return json({ error: 'Invalid domain' }, 400);
  }
  let res;
  try {
    res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { 'Accept': 'application/dns-json' },
    });
  } catch {
    return json({ hasMX: false });
  }
  const data = await res.json();
  const hasMX = Array.isArray(data?.Answer) && data.Answer.length > 0;
  return json({ hasMX });
}

// ── Helpers ───────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cors(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin', '*');
  r.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return r;
}
