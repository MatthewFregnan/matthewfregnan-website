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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['uploads', id?, part|'complete'?]
    if (parts[0] !== 'uploads' && parts[0] !== 'usage') return json(request, { error: 'Not found' }, 404);
    if (!(await authorised(request, env))) {
      return json(request, { error: 'Not signed in, or this GitHub token can’t write to the website repo.' }, 401);
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
