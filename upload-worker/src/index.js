// Upload service for the web admin.
//
// Who can upload: only someone signed in to the admin with a GitHub token that has write access
// to the website repo (checked against GitHub on every new token). The R2 bucket is bound to this
// Worker, so no storage keys ever reach a web page.
//
// Uploads go in chunks (R2 multipart), so big files work despite request-size limits:
//   POST   /uploads?key=<category>/<project>.mp4          -> { uploadId }
//   PUT    /uploads/<uploadId>/<partNumber>?key=...        (body = chunk) -> { partNumber, etag }
//   POST   /uploads/<uploadId>/complete?key=...            (body = { parts: [...] }) -> { url }
//   DELETE /uploads/<uploadId>?key=...                     -> aborts
//   GET    /usage                                          -> { objects: [{ key, size, uploaded }], total }
//
// Visit stats (anonymous, no cookies; see schema.sql):
//   POST   /hit       (from the site, no sign-in)  body = {t:'view'|'leave', v, s, p, r, secs}
//   GET    /stats?days=30   (signed in)            -> { rows: [[ts, visit, seq, path, source, country, device, secs, city]] }
//   DELETE /stats           (signed in)            -> { deleted } (reset: removes every recorded visit)

const ALLOWED_ORIGINS = ['https://matthewfregnan.com', 'https://www.matthewfregnan.com'];
const KEY_PATTERN = /^(commercial|branded|vertical|colour-grading|home)\/[a-z0-9][a-z0-9-]{0,120}\.mp4$/;
const PUBLIC_BASE = 'https://videos.matthewfregnan.com';
const AUTH_CACHE_MS = 10 * 60 * 1000;

const authCache = new Map(); // sha256(token) -> expiry time (per Worker instance)

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowed = ALLOWED_ORIGINS.includes(origin) || local;
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** True if the bearer token can push to the website repo. */
async function authorised(request, env) {
  const m = /^Bearer\s+(\S+)$/.exec(request.headers.get('Authorization') || '');
  if (!m) return false;
  const token = m[1];
  // Local testing only (`wrangler dev` with a .dev.vars file); never set on the live service.
  if (env.TEST_TOKEN && token === env.TEST_TOKEN) return true;
  const id = await sha256(token);
  if ((authCache.get(id) || 0) > Date.now()) return true;
  const res = await fetch(`https://api.github.com/repos/${env.REPO}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'matthewfregnan-upload',
    },
  });
  if (!res.ok) return false;
  const repo = await res.json();
  if (!repo.permissions || !repo.permissions.push) return false;
  authCache.set(id, Date.now() + AUTH_CACHE_MS);
  return true;
}

// ---------------------------------------------------------------------------- visit stats

const SITE_ORIGIN = /^https:\/\/(www\.)?matthewfregnan\.com$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const BOTS = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|python|curl|wget/i;
const SOURCES = [
  [/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/, 'LinkedIn'], [/(^|\.)google\./, 'Google'], [/(^|\.)bing\.com$/, 'Bing'],
  [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'], [/(^|\.)instagram\.com$/, 'Instagram'], [/(^|\.)facebook\.com$|(^|\.)fb\.com$/, 'Facebook'],
  [/(^|\.)t\.co$|(^|\.)x\.com$|(^|\.)twitter\.com$/, 'X'], [/(^|\.)tiktok\.com$/, 'TikTok'], [/(^|\.)vimeo\.com$/, 'Vimeo'],
  [/(^|\.)youtube\.com$/, 'YouTube'], [/(^|\.)seek\.com\.au$/, 'SEEK'], [/mail\.|outlook\.|(^|\.)gmail\./, 'Email'],
];

function sourceOf(referrer) {
  if (!referrer) return 'Direct';
  let host;
  try { host = new URL(referrer).hostname.replace(/^www\./, ''); } catch { return 'Direct'; }
  if (/(^|\.)matthewfregnan\.com$/.test(host)) return 'Direct';
  const hit = SOURCES.find(([re]) => re.test(host));
  return hit ? hit[1] : host.slice(0, 60);
}

function deviceOf(ua) {
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(ua)) return 'phone';
  return 'computer';
}

async function recordHit(request, env) {
  const ok = new Response(null, { status: 204 });
  if (!SITE_ORIGIN.test(request.headers.get('Origin') || '')) return ok;
  const ua = request.headers.get('User-Agent') || '';
  if (!ua || BOTS.test(ua)) return ok;
  let b;
  try { b = JSON.parse(await request.text()); } catch { return ok; }
  const visit = String(b.v || '');
  const seq = Number(b.s);
  if (!/^[a-z0-9]{8,32}$/.test(visit) || !Number.isInteger(seq) || seq < 1 || seq > 300) return ok;
  if (b.t === 'leave') {
    const secs = Math.round(Number(b.secs));
    if (secs > 0 && secs < 6 * 3600) {
      await env.STATS.prepare('UPDATE views SET secs = ? WHERE visit = ? AND seq = ?').bind(secs, visit, seq).run();
    }
    return ok;
  }
  const path = String(b.p || '');
  if (!/^\/[a-z0-9\-/]{0,200}$/.test(path) || path.startsWith('/admin')) return ok;
  const cf = request.cf || {};
  const row = [Date.now(), visit, seq, path, seq === 1 ? sourceOf(String(b.r || '')) : null, cf.country || null, deviceOf(ua)];
  // City comes from Cloudflare's own lookup; the IP address itself is never stored.
  const city = typeof cf.city === 'string' ? cf.city.slice(0, 60) : null;
  try {
    await env.STATS.prepare('INSERT INTO views (ts, visit, seq, path, source, country, device, city) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(...row, city).run();
  } catch {   // database not updated with the city column yet: still record the visit
    await env.STATS.prepare('INSERT INTO views (ts, visit, seq, path, source, country, device) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(...row).run();
  }
  return ok;
}

async function stats(request, env, url) {
  const days = Math.min(400, Math.max(1, parseInt(url.searchParams.get('days'), 10) || 30));
  const since = Date.now() - days * 86400000;
  // keep about a year
  await env.STATS.prepare('DELETE FROM views WHERE ts < ?').bind(Date.now() - 400 * 86400000).run();
  let results;
  try {
    ({ results } = await env.STATS.prepare(
      'SELECT ts, visit, seq, path, source, country, device, secs, city FROM views WHERE ts >= ? ORDER BY ts LIMIT 200000',
    ).bind(since).all());
  } catch {   // no city column yet
    ({ results } = await env.STATS.prepare(
      'SELECT ts, visit, seq, path, source, country, device, secs FROM views WHERE ts >= ? ORDER BY ts LIMIT 200000',
    ).bind(since).all());
  }
  return json(request, { days, rows: results.map(r => [r.ts, r.visit, r.seq, r.path, r.source, r.country, r.device, r.secs, r.city || null]) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Page views come from the public site (no sign-in), sent with navigator.sendBeacon
    if (url.pathname === '/hit') {
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      try { return await recordHit(request, env); } catch { return new Response(null, { status: 204 }); }
    }

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });

    const parts = url.pathname.split('/').filter(Boolean); // ['uploads', id?, part|'complete'?]
    if (!['uploads', 'usage', 'stats'].includes(parts[0])) return json(request, { error: 'Not found' }, 404);
    if (!(await authorised(request, env))) {
      return json(request, { error: 'Not signed in, or this GitHub token can’t write to the website repo.' }, 401);
    }

    if (parts[0] === 'stats' && request.method === 'GET') return stats(request, env, url);
    if (parts[0] === 'stats' && request.method === 'DELETE') {
      const r = await env.STATS.prepare('DELETE FROM views').run();
      return json(request, { deleted: r.meta?.changes ?? 0 });
    }

    // What's in storage (for the admin's Storage view)
    if (parts[0] === 'usage' && request.method === 'GET') {
      const objects = [];
      let cursor;
      do {
        const page = await env.VIDEOS.list({ limit: 1000, cursor });
        for (const o of page.objects) objects.push({ key: o.key, size: o.size, uploaded: o.uploaded });
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return json(request, { objects, total: objects.reduce((n, o) => n + o.size, 0), base: PUBLIC_BASE });
    }
    const key = url.searchParams.get('key') || '';
    if (!KEY_PATTERN.test(key)) return json(request, { error: 'Invalid video address.' }, 400);

    try {
      // Start an upload
      if (request.method === 'POST' && parts.length === 1) {
        const mpu = await env.VIDEOS.createMultipartUpload(key, {
          httpMetadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=86400' },
        });
        return json(request, { uploadId: mpu.uploadId, key });
      }
      const uploadId = parts[1];
      if (!uploadId) return json(request, { error: 'Missing upload id.' }, 400);
      const mpu = env.VIDEOS.resumeMultipartUpload(key, uploadId);

      // Upload one chunk
      if (request.method === 'PUT' && parts.length === 3) {
        const partNumber = Number(parts[2]);
        if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
          return json(request, { error: 'Invalid part number.' }, 400);
        }
        if (!request.body) return json(request, { error: 'Empty chunk.' }, 400);
        const uploaded = await mpu.uploadPart(partNumber, request.body);
        return json(request, { partNumber: uploaded.partNumber, etag: uploaded.etag });
      }

      // Finish
      if (request.method === 'POST' && parts[2] === 'complete') {
        const body = await request.json();
        const object = await mpu.complete(body.parts || []);
        return json(request, { url: `${PUBLIC_BASE}/${key}?v=${Date.now()}`, size: object.size });
      }

      // Cancel
      if (request.method === 'DELETE' && parts.length === 2) {
        await mpu.abort();
        return json(request, { aborted: true });
      }
    } catch (e) {
      return json(request, { error: `Upload failed: ${e.message || e}` }, 500);
    }
    return json(request, { error: 'Not found' }, 404);
  },
};
