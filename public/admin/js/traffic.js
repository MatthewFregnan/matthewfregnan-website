// Traffic: turns the raw, anonymous page views from the upload service into daily visitors, top
// pages, where visitors came from and the paths they took. Shared by the web admin and the
// desktop app (which loads this file into its built-in browser view).
//
// A row is [ts, visit, seq, path, source, country, device, secs].

const DAY = 86400000;
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function summarise(allRows, days, now = Date.now()) {
  // Watch events (/watch/<page>/<start|25|50|75|end>/) are how far people watched a hosted video, not
  // page views: counted separately (see "watching" below) and left out of everything else.
  const isWatch = r => String(r[3]).startsWith('/watch/');
  const rows = allRows.filter(r => !isWatch(r));
  const watchRows = allRows.filter(isWatch);
  const visits = new Map();   // visit -> { pages: [{seq, path, secs}], source, country, device, start }
  for (const [ts, visit, seq, path, source, country, device, secs, city] of rows) {
    let v = visits.get(visit);
    if (!v) { v = { id: visit, pages: [], source: null, country, city: null, device, start: ts }; visits.set(visit, v); }
    if (city && !v.city) v.city = city;
    v.pages.push({ seq, path, secs: secs || 0, ts });
    if (seq === 1 && source) v.source = source;
    v.start = Math.min(v.start, ts);
  }
  for (const v of visits.values()) {
    v.pages.sort((a, b) => a.seq - b.seq);
    // the same page reloaded twice in a row counts once in a path
    v.path = v.pages.map(p => p.path).filter((p, i, a) => i === 0 || p !== a[i - 1]);
    v.secs = v.pages.reduce((n, p) => n + p.secs, 0);
    if (!v.source) v.source = 'Direct';
  }

  // Visitors and page views per local day, including days with none. "Today" (days = 1) is the last
  // 24 hours, one bar per hour.
  const daily = [];
  const byDay = new Map();
  const HOUR = 3600000;
  const hourly = days === 1;
  const keyOf = hourly ? (t => Math.floor(t / HOUR)) : dayKey;
  if (hourly) {
    for (let i = 23; i >= 0; i -= 1) {
      const t = now - i * HOUR;
      const k = keyOf(t);
      const at = new Date(k * HOUR);
      const d = { day: dayKey(t), hour: at.getHours(), label: at.toLocaleTimeString(undefined, { hour: 'numeric' }), visitors: 0, views: 0 };
      byDay.set(k, d); daily.push(d);
    }
  } else {
    const start = new Date(now - (days - 1) * DAY);
    start.setHours(0, 0, 0, 0);
    for (let t = start.getTime(); t <= now; t += DAY) {
      const k = dayKey(t);
      if (!byDay.has(k)) { const d = { day: k, visitors: 0, views: 0 }; byDay.set(k, d); daily.push(d); }
    }
  }
  for (const [ts] of rows) { const d = byDay.get(keyOf(ts)); if (d) d.views += 1; }
  for (const v of visits.values()) { const d = byDay.get(keyOf(v.start)); if (d) d.visitors += 1; }

  const count = (items, key) => {
    const m = new Map();
    for (const it of items) { const k = key(it); if (k != null) m.set(k, (m.get(k) || 0) + 1); }
    return [...m].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  };
  const vs = [...visits.values()];

  const pages = new Map();
  for (const v of vs) {
    const seen = new Set();
    for (const p of v.pages) {
      const e = pages.get(p.path) || { path: p.path, views: 0, visitors: 0, secs: 0, timed: 0 };
      e.views += 1;
      if (p.secs) { e.secs += p.secs; e.timed += 1; }
      if (!seen.has(p.path)) { e.visitors += 1; seen.add(p.path); }
      pages.set(p.path, e);
    }
  }

  const journeys = count(vs.filter(v => v.path.length > 1), v => v.path.slice(0, 4).join(' → '))
    .map(j => ({ steps: j.name.split(' → '), n: j.n }));

  const totalViews = rows.length;
  return {
    days,
    totals: {
      visitors: vs.length,
      views: totalViews,
      pagesPerVisit: vs.length ? totalViews / vs.length : 0,
      avgSecs: vs.length ? vs.reduce((n, v) => n + v.secs, 0) / vs.length : 0,
      oneAndDone: vs.length ? vs.filter(v => v.path.length === 1).length / vs.length : 0,
    },
    daily,
    pages: [...pages.values()].map(p => ({ ...p, avgSecs: p.timed ? p.secs / p.timed : 0 })).sort((a, b) => b.views - a.views),
    sources: count(vs, v => v.source),
    countries: count(vs, v => v.country || '??'),
    cities: count(vs.filter(v => v.city), v => `${v.city}|${v.country || ''}`),
    watching: watching(watchRows),
    // every visit, newest first, for the visit-by-visit log
    visits: vs.slice().sort((a, b) => b.start - a.start),
    devices: count(vs, v => v.device || 'computer'),
    entries: count(vs, v => v.path[0]),
    journeys,
  };
}

export function fmtSecs(s) {
  s = Math.round(s);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

let regionNames;
function countryName(code) {
  if (!code || code === '??' || code === 'XX' || code === 'T1') return 'Unknown';
  try { regionNames ||= new Intl.DisplayNames(['en'], { type: 'region' }); return regionNames.of(code); } catch { return code; }
}

/** A simple bar chart of visitors per day (SVG, scales to its box). */
function chart(h, daily) {
  const W = 760, H = 180, pad = 26;
  const max = Math.max(1, ...daily.map(d => d.visitors));
  const bw = (W - pad) / daily.length;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H + 22}`);
  svg.setAttribute('class', 'tr-chart');
  const el = (tag, attrs, text) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    svg.append(e);
    return e;
  };
  for (const f of (max < 2 ? [1] : [0.5, 1])) {   // no half-way line (a second "1") when the top is 1
    const y = H - (H - 8) * f;
    el('line', { x1: pad, x2: W, y1: y, y2: y, class: 'tr-grid' });
    el('text', { x: pad - 6, y: y + 4, 'text-anchor': 'end', class: 'tr-axis' }, String(Math.round(max * f)));
  }
  el('line', { x1: pad, x2: W, y1: H, y2: H, class: 'tr-grid' });
  daily.forEach((d, i) => {
    const bh = (H - 8) * (d.visitors / max);
    const x = pad + i * bw + bw * 0.15;
    const r = el('rect', { x, y: H - bh, width: Math.max(1, bw * 0.7), height: Math.max(bh, d.visitors ? 2 : 0), rx: 2, class: 'tr-bar' });
    const t = document.createElementNS(ns, 'title');
    const when = d.label || new Date(`${d.day}T00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    t.textContent = `${when}: ${d.visitors} visitor${d.visitors === 1 ? '' : 's'}, ${d.views} page view${d.views === 1 ? '' : 's'}`;
    r.append(t);
    // about 8 date labels; the last day always gets one (right-aligned), unless it would crowd the one before
    const every = Math.ceil(daily.length / 8);
    const last = i === daily.length - 1;
    const regular = i % every === 0 && (daily.length - 1 - i >= every * 0.6 || last);
    if (regular || last) {
      el('text', { x: last ? W : x + bw * 0.35, y: H + 16, 'text-anchor': last ? 'end' : 'middle', class: 'tr-axis' },
        d.label || new Date(`${d.day}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
    }
  });
  return svg;
}

/**
 * The Traffic page body. opts: { titleOf(path) -> string, onPath(path) optional }.
 */
export function renderTraffic(h, sum, opts = {}) {
  const titleOf = opts.titleOf || (p => p);
  const t = sum.totals;
  const tile = (label, value, hint) => h('div', { class: 'tr-kpi' }, h('span', { class: 'tr-kpi-label' }, label), h('strong', {}, value), hint ? h('span', { class: 'tr-kpi-hint' }, hint) : null);
  const bar = (n, max) => h('span', { class: 'tr-meter' }, h('span', { style: `width:${Math.max(2, (n / Math.max(1, max)) * 100)}%` }));
  const list = (title, items, render, empty) => h('section', { class: 'tr-card' }, h('h4', {}, title),
    items.length ? h('div', { class: 'tr-list' }, items) : h('p', { class: 'muted small' }, empty || 'Nothing yet.'));
  const pageLink = path => (opts.onPath ? h('a', { href: '#', onclick: e => { e.preventDefault(); opts.onPath(path); } }, titleOf(path)) : titleOf(path));

  if (!t.views) {
    return h('div', { class: 'tr' }, h('p', { class: 'muted' },
      `No visits recorded ${sum.days === 1 ? 'in the last 24 hours' : `in the last ${sum.days} days`} yet. Stats start from when tracking went live (or was last reset); check back after a few visits.`));
  }
  const maxPage = sum.pages[0]?.views || 1;
  const maxSrc = sum.sources[0]?.n || 1;
  return h('div', { class: 'tr' },
    h('div', { class: 'tr-kpis' },
      tile('Visitors', String(t.visitors), sum.days === 1 ? 'last 24 hours' : `last ${sum.days} days`),
      tile('Page views', String(t.views)),
      tile('Pages per visit', t.pagesPerVisit.toFixed(1)),
      tile('Time per visit', fmtSecs(t.avgSecs), 'average'),
      tile('Left after one page', `${Math.round(t.oneAndDone * 100)}%`)),
    h('section', { class: 'tr-card' }, h('h4', {}, sum.days === 1 ? 'Visitors per hour' : 'Visitors per day'), chart(h, sum.daily)),
    h('div', { class: 'tr-cols' },
      list('Most viewed', sum.pages.slice(0, 12).map(p => h('div', { class: 'tr-row' },
        h('span', { class: 'tr-name', title: p.path }, pageLink(p.path)),
        bar(p.views, maxPage),
        h('span', { class: 'tr-num', title: `${p.visitors} visitors${p.avgSecs ? ` · ${fmtSecs(p.avgSecs)} average` : ''}` }, String(p.views))))),
      h('div', {},
        list('Where visitors came from', sum.sources.slice(0, 10).map(s => h('div', { class: 'tr-row' },
          h('span', { class: 'tr-name' }, s.name), bar(s.n, maxSrc), h('span', { class: 'tr-num' }, String(s.n))))),
        list('First page they saw', sum.entries.slice(0, 6).map(s => h('div', { class: 'tr-row' },
          h('span', { class: 'tr-name' }, pageLink(s.name)), h('span', {}), h('span', { class: 'tr-num' }, String(s.n))))))),
    list('Common paths through the site', sum.journeys.slice(0, 10).map(j => h('div', { class: 'tr-path' },
      h('span', { class: 'tr-steps' }, j.steps.flatMap((s, i) => [i ? h('span', { class: 'tr-arrow' }, '→') : null, h('span', { class: 'tr-step' }, pageLink(s))])),
      h('span', { class: 'tr-num' }, `${j.n} visit${j.n === 1 ? '' : 's'}`))),
    'Paths appear once visitors look at more than one page.'),
    h('div', { class: 'tr-cols' },
      sum.cities.length
        ? list('Cities', sum.cities.slice(0, 8).map(c => { const [city, cc] = c.name.split('|'); return h('div', { class: 'tr-row' },
          h('span', { class: 'tr-name' }, `${city}${cc ? `, ${countryName(cc)}` : ''}`), h('span', {}), h('span', { class: 'tr-num' }, String(c.n))); }))
        : list('Countries', sum.countries.slice(0, 8).map(c => h('div', { class: 'tr-row' },
          h('span', { class: 'tr-name' }, countryName(c.name)), h('span', {}), h('span', { class: 'tr-num' }, String(c.n))))),
      list('Devices', sum.devices.map(d => h('div', { class: 'tr-row' },
        h('span', { class: 'tr-name' }, d.name[0].toUpperCase() + d.name.slice(1)), h('span', {}),
        h('span', { class: 'tr-num' }, `${Math.round((d.n / t.visitors) * 100)}%`))))),
    watchingCard(h, sum.watching, pageLink),
    visitLog(h, sum.visits, titleOf, pageLink),
    h('p', { class: 'muted small' }, 'Anonymous: no cookies, no IP addresses. A visit is one browser tab session (it resets after 30 idle minutes). Visitors who switch on Do Not Track aren’t counted.'));
}

/** Per video page: how many plays, and how many reached a quarter, half, three quarters and the end. */
function watching(rows) {
  const by = new Map();
  for (const [, visit, , path] of rows) {
    const m = String(path).match(/^\/watch(\/.+\/)(start|25|50|75|end)\/$/);
    if (!m) continue;
    const e = by.get(m[1]) || { path: m[1], start: new Set(), 25: new Set(), 50: new Set(), 75: new Set(), end: new Set() };
    e[m[2]].add(visit);
    by.set(m[1], e);
  }
  return [...by.values()].map(e => ({ path: e.path, plays: e.start.size, q25: e[25].size, q50: e[50].size, q75: e[75].size, end: e.end.size }))
    .filter(e => e.plays).sort((a, b) => b.plays - a.plays);
}

function watchingCard(h, items, pageLink) {
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  return h('section', { class: 'tr-card' },
    h('h4', {}, 'Watching'),
    h('p', { class: 'muted small', style: 'margin:0 0 8px' }, 'How far people watch your hosted videos (YouTube, Vimeo and other embeds can’t report this). One play per visit.'),
    items.length ? h('div', { class: 'tr-list' }, items.slice(0, 15).map(w => h('div', { class: 'tr-watch' },
      h('span', { class: 'tr-name' }, pageLink(w.path)),
      h('span', { class: 'tr-funnel', title: `Played ${w.plays} · ¼ ${pct(w.q25, w.plays)}% · ½ ${pct(w.q50, w.plays)}% · ¾ ${pct(w.q75, w.plays)}% · end ${pct(w.end, w.plays)}%` },
        [w.q25, w.q50, w.q75, w.end].map(n => h('span', { style: `--f:${pct(n, w.plays)}%` }))),
      h('span', { class: 'tr-num' }, `${w.plays} play${w.plays === 1 ? '' : 's'} · ${pct(w.q50, w.plays)}% halfway · ${pct(w.end, w.plays)}% to the end`))))
      : h('p', { class: 'muted small' }, 'No plays of hosted videos yet.'));
}

/** A steady colour for a visit, so one person's journey is easy to follow down the log. */
function visitColour(id) {
  let n = 0;
  for (const c of id) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${n % 360} 70% 62%)`;
}

const DEVICE_ICON = { phone: '📱', tablet: '📱', computer: '💻' };

/** Visit by visit: when, where from, where, which device, and the pages in order with time on each. */
function visitLog(h, visits, titleOf, pageLink) {
  const SHOW = 60;
  const when = ts => {
    const d = new Date(ts);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (ts >= today.getTime()) return `Today ${time}`;
    if (ts >= today.getTime() - DAY) return `Yesterday ${time}`;
    return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
  };
  const row = v => {
    const colour = visitColour(v.id);
    const place = [v.city, v.country ? countryName(v.country) : ''].filter(Boolean).join(', ') || 'Unknown place';
    return h('div', { class: 'tr-visit', style: `--vc:${colour}` },
      h('div', { class: 'tr-visit-head' },
        h('span', { class: 'tr-visit-dot' }),
        h('strong', {}, when(v.start)),
        h('span', { class: 'muted' }, ` · ${v.source} · ${place} · ${DEVICE_ICON[v.device] || ''} ${v.device || 'computer'}`),
        h('span', { class: 'tr-num' }, `${v.pages.length} page${v.pages.length === 1 ? '' : 's'}${v.secs ? ` · ${fmtSecs(v.secs)}` : ''}`)),
      h('div', { class: 'tr-visit-pages' }, v.pages.flatMap((p, i) => [
        i ? h('span', { class: 'tr-arrow' }, '→') : null,
        h('span', { class: 'tr-step' }, pageLink(p.path), p.secs ? h('span', { class: 'muted' }, ` ${fmtSecs(p.secs)}`) : null)])));
  };
  return h('section', { class: 'tr-card' },
    h('h4', {}, `Visit by visit${visits.length > SHOW ? ` (latest ${SHOW} of ${visits.length})` : ''}`),
    h('p', { class: 'muted small', style: 'margin:0 0 8px' }, 'Each colour is one visit (one browser tab session), so you can follow a person’s path through the site.'),
    visits.length ? h('div', { class: 'tr-visits' }, visits.slice(0, SHOW).map(row)) : h('p', { class: 'muted small' }, 'No visits yet.'));
}

/** Tiny line of the last days' visitors for the Overview card. */
export function sparkline(h, daily) {
  const W = 220, H = 36;
  const max = Math.max(1, ...daily.map(d => d.visitors));
  const pts = daily.map((d, i) => `${(i / Math.max(1, daily.length - 1)) * W},${H - 3 - (d.visitors / max) * (H - 6)}`).join(' ');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'tr-spark');
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', pts);
  svg.append(line);
  return svg;
}
