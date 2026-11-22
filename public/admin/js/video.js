// Video links: parsing, ordering (first choice + backups), embed URLs and "does it play?" checks.
// Mirrors app/core.py so the web admin and desktop app behave the same.

export const SOURCES = ['vimeo', 'youtube', 'instagram'];
export const NAMES = { vimeo: 'Vimeo', youtube: 'YouTube', instagram: 'Instagram' };
const KEYS = { vimeo: 'vimeoId', youtube: 'youtubeId', instagram: 'instagramId' };

export function pageUrl(ref) {
  if (ref.kind === 'vimeo') return `https://vimeo.com/${ref.id}${ref.hash ? `/${ref.hash}` : ''}`;
  if (ref.kind === 'instagram') return `https://www.instagram.com/p/${ref.id}/`;
  return `https://www.youtube.com/watch?v=${ref.id}`;
}

export function embedUrl(ref) {
  if (ref.kind === 'vimeo') {
    return `https://player.vimeo.com/video/${ref.id}?${ref.hash ? `h=${ref.hash}&` : ''}title=0&byline=0&portrait=0`;
  }
  if (ref.kind === 'instagram') return `https://www.instagram.com/p/${ref.id}/embed/`;
  return `https://www.youtube.com/embed/${ref.id}?rel=0&modestbranding=1`;
}

/** Accept a Vimeo/YouTube/Instagram link or a bare ID. `hint` = which box it was typed in. */
export function parseVideo(text, hint) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (!t.includes('/') && !t.includes('.')) {
    if (/^\d{5,}$/.test(t)) return { kind: 'vimeo', id: t, hash: '' };
    if (hint === 'instagram' && /^[\w-]{5,}$/.test(t)) return { kind: 'instagram', id: t, hash: '' };
    if (/^[\w-]{11}$/.test(t)) return { kind: 'youtube', id: t, hash: '' };
    return null;
  }
  let u;
  try {
    u = new URL(t.includes('://') ? t : `https://${t}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  if (host.endsWith('vimeo.com')) {
    const i = parts.findIndex(p => /^\d+$/.test(p));
    if (i >= 0) {
      let hash = u.searchParams.get('h') || '';
      if (!hash && /^[0-9a-f]{6,}$/.test(parts[i + 1] || '')) hash = parts[i + 1];
      return { kind: 'vimeo', id: parts[i], hash };
    }
  }
  if (host === 'youtu.be' && parts[0]) return { kind: 'youtube', id: parts[0], hash: '' };
  if (host.endsWith('youtube.com')) {
    if (u.searchParams.get('v')) return { kind: 'youtube', id: u.searchParams.get('v'), hash: '' };
    const m = u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{11})/);
    if (m) return { kind: 'youtube', id: m[1], hash: '' };
  }
  if (host.endsWith('instagram.com') || host === 'instagr.am') {
    const i = parts.findIndex(p => ['p', 'reel', 'reels', 'tv'].includes(p));
    if (i >= 0 && parts[i + 1]) return { kind: 'instagram', id: parts[i + 1], hash: '' };
  }
  return null;
}

export function sources(p) {
  const out = {};
  for (const kind of SOURCES) {
    const v = String(p[KEYS[kind]] || '').trim();
    if (!v) continue;
    const ref = v.includes('/') || v.includes('.') ? parseVideo(v, kind) : { kind, id: v, hash: '' };
    if (ref && ref.kind === kind) {
      if (kind === 'vimeo' && !ref.hash) ref.hash = p.vimeoHash || '';
      out[kind] = ref;
    }
  }
  return out;
}

/** The chosen source first, then the others as backups (same order the website uses). */
export function ordered(p) {
  const s = sources(p);
  return SOURCES.filter(k => s[k]).sort((a, b) => (b === p.videoPrimary) - (a === p.videoPrimary)).map(k => s[k]);
}

export function setSource(p, kind, ref) {
  delete p[KEYS[kind]];
  if (kind === 'vimeo') delete p.vimeoHash;
  if (ref) {
    p[KEYS[kind]] = ref.id;
    if (ref.hash) p.vimeoHash = ref.hash;
  }
  if (p.videoPrimary && !sources(p)[p.videoPrimary]) delete p.videoPrimary;
}

// ------------------------------------------------------------------ checking (cached a day)

const CACHE_KEY = 'pm-video-status';
const DAY = 24 * 3600 * 1000;
const cache = (() => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
  } catch {
    return {};
  }
})();
const inflight = new Map();
const listeners = new Set();

export const onChecked = fn => listeners.add(fn);
export const status = ref => (ref ? cache[pageUrl(ref)] : undefined);

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* storage full or blocked: checks just won't be remembered */ }
}

async function fetchStatus(ref) {
  if (ref.kind === 'instagram') {
    return { ok: null, message: "Instagram links can't be checked automatically. Open it to make sure the post is public." };
  }
  const api = ref.kind === 'vimeo'
    ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(pageUrl(ref))}`
    : `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(pageUrl(ref))}`;
  let res;
  try {
    res = await fetch(api);
  } catch {
    return { ok: false, message: `Couldn't reach ${NAMES[ref.kind]}`, offline: true };
  }
  if (!res.ok) {
    return [401, 403, 404].includes(res.status)
      ? { ok: false, message: "Can't be embedded: it's private, deleted, or embedding is turned off" }
      : { ok: false, message: `${NAMES[ref.kind]} returned an error (${res.status})`, offline: true };
  }
  const j = await res.json();
  const thumb = ref.kind === 'vimeo'
    ? String(j.thumbnail_url || '').replace(/-d_\d+(x\d+)?/, '-d_1920')
    : `https://i.ytimg.com/vi/${ref.id}/maxresdefault.jpg`;
  return {
    ok: true, message: 'Plays', title: j.title || '', thumbnail: thumb,
    uploadDate: j.upload_date || '', width: j.width || 0, height: j.height || 0,
  };
}

/** Check a link (skipped if checked in the last day, unless `force`). Resolves to its status. */
export function check(ref, force = false) {
  const url = pageUrl(ref);
  const known = cache[url];
  if (known && !force && Date.now() - known.at < DAY) return Promise.resolve(known);
  if (inflight.has(url)) return inflight.get(url);
  const job = fetchStatus(ref).then(st => {
    // A network blip shouldn't turn a known-good link red
    if (st.offline && known) st = known;
    else st.at = Date.now();
    cache[url] = st;
    saveCache();
    inflight.delete(url);
    listeners.forEach(fn => fn(url));
    return st;
  });
  inflight.set(url, job);
  return job;
}

/** ok = first choice plays · backup = site will fall back · bad = nothing plays · unknown = not checked */
export function state(p) {
  const refs = ordered(p);
  if (!refs.length) return null;
  const sts = refs.map(status);
  if (!sts[0]) return 'unknown';
  if (sts[0].ok !== false) return 'ok';
  if (sts.slice(1).some(s => !s || s.ok !== false)) return 'backup';
  return 'bad';
}

/** Make upload filenames like 'KIA_SHIPYARD_9x16_MASTER_v03' read like a title. */
export function tidyTitle(title) {
  let t = String(title || '').trim().replace(/\.(mp4|mov|mxf)$/i, '');
  if (t.includes('_') && !t.includes(' ')) t = t.replace(/_/g, ' ');
  t = t.replace(/\b(\d+x\d+|master|clean|final|v\d+|r\d+|\d+s(ec)?)\b/gi, '')
    .replace(/\b[A-Z]?\d{5,}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-_]+|[\s\-_]+$/g, '');
  if (t && t === t.toUpperCase() && /[A-Z]/.test(t)) {
    t = t.split(' ').map(w => (w.length <= 3 && /^[A-Z]+$/.test(w) && !['THE', 'AND', 'FOR'].includes(w)
      ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(' ')
      .replace(/\b(And|For|The|With|Of|In|On|To)\b/g, m => m.toLowerCase());
    t = t.charAt(0).toUpperCase() + t.slice(1);
  }
  return t;
}
