// Click counter for flight-watch (Cloudflare Workers, free plan). Paste this file into the Worker's editor.
// Bindings it needs (see CLICKS-SETUP.md): a KV namespace bound as CLICKS, and a secret named SECRET.
//   GET /c?u=<user id>&s=<site>&t=<message type>&to=<url>&k=<signature>
//       counts one click and redirects to <url> at once. The signature (made by the bot with the same SECRET)
//       stops anyone from using this address to redirect to other sites.
//   GET /stats  (header "Authorization: Bearer <SECRET>")  -> {"2026-11-15|u3a3b26b74b|kayak|alert": 2, ...}
// Stored: only "date|random user id|site|message type" -> count, for 90 days. No IPs, no links, no routes.
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/stats') {
      if (!env.SECRET || req.headers.get('authorization') !== `Bearer ${env.SECRET}`) return new Response('forbidden', { status: 403 });
      const out = {};
      let cursor;
      do {
        const r = await env.CLICKS.list({ cursor });
        for (const k of r.keys) out[k.name] = (k.metadata && k.metadata.n) || 0;
        cursor = r.list_complete ? null : r.cursor;
      } while (cursor);
      return Response.json(out);
    }
    if (url.pathname !== '/c') return new Response('not found', { status: 404 });
    const p = url.searchParams;
    const [u, s, t, to] = ['u', 's', 't', 'to'].map((k) => p.get(k) || '');
    if (!/^[\w-]{1,24}$/.test(u) || !/^[a-z]{1,12}$/.test(s) || !/^[a-z-]{1,20}$/.test(t) || !/^https:\/\//.test(to)
      || p.get('k') !== await sign(env.SECRET, `${u}|${s}|${t}|${to}`)) return new Response('bad link', { status: 400 });
    ctx.waitUntil(count(env, `${new Date().toISOString().slice(0, 10)}|${u}|${s}|${t}`).catch(() => {}));
    return Response.redirect(to, 302);
  },
};

async function count(env, key) {
  const { metadata } = await env.CLICKS.getWithMetadata(key);
  const n = ((metadata && metadata.n) || 0) + 1;
  await env.CLICKS.put(key, '', { metadata: { n }, expirationTtl: 90 * 86400 });
}

// First 16 hex characters of HMAC-SHA256(secret, text); the same as lib/clicks.js sign().
async function sign(secret, text) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
