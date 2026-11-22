// Live previews of the site, drawn inside the admin from the data being edited (no build needed).
// They copy the real site's layout rules (templates/home.ejs, project.ejs and src/styles.css) at a
// fixed "virtual" screen width, then scale down to fit the panel, so what you see is what the
// site will lay out. Fonts and images are the real ones; videos show their thumbnail.

const NAV = ['Commercial', 'Branded', 'Social', 'Colour', 'About', 'Contact'];
export const SCREENS = {
  desktop: { width: 1440, height: 900, label: 'Laptop / desktop' },
  phone: { width: 390, height: 844, label: 'Phone' },
};

/**
 * Wrap `frame` (laid out at `width` px) so it scales to the width of its container.
 * Returns the wrapper element; it keeps itself sized as the panel resizes.
 */
export function scaled(h, frame, width) {
  frame.style.width = `${width}px`;
  const wrap = h('div', { class: 'pv-scaler' }, frame);
  const fit = () => {
    const w = wrap.clientWidth;
    if (!w) return;
    const s = Math.min(1, w / width);
    frame.style.transform = `scale(${s})`;
    wrap.style.height = `${Math.ceil(frame.offsetHeight * s)}px`;
  };
  new ResizeObserver(fit).observe(wrap);
  new ResizeObserver(fit).observe(frame);
  requestAnimationFrame(fit);
  return wrap;
}

function nav(h, site, phone, current) {
  return h('div', { class: 'pv-nav' },
    h('span', { class: 'pv-brand' }, site.title || 'Matthew Fregnan'),
    phone ? h('span', { class: 'pv-burger' }, '☰')
      : h('span', { class: 'pv-links' }, NAV.map(n => h('span', { class: n === current ? 'on' : '' }, n))));
}

function img(h, src, focus, cls = '') {
  return src ? h('img', { class: cls, src, alt: '', loading: 'lazy', style: focus ? `object-position:${focus}` : '' })
    : h('span', { class: `pv-noimg ${cls}` });
}

function tile(h, p, { vertical, thumb, badge, onPick }) {
  return h('div', { class: `pv-tile${vertical ? ' v' : ''}`, title: p.title, onclick: onPick ? () => onPick(p) : null },
    img(h, thumb(p), p.thumbFocus),
    badge ? h('span', { class: `pv-badge ${badge.kind}` }, badge.text) : null,
    h('div', { class: 'pv-tile-title' }, h('b', {}, p.title || '(untitled)'), p.client ? h('small', {}, p.client) : null));
}

/** Which landscape projects show, matching build.js (locked first, then shuffle or the top of the list). */
export function featuredPick(set, landscape, seed = 0) {
  const count = Math.max(0, parseInt(set.featuredCount, 10) || 0);
  if (!count || count >= landscape.length) return { shown: landscape, count: 0 };
  const lockedKeys = new Set(set.locked || []);
  const key = p => `${p.category}/${p.id}`;
  const locked = landscape.filter(p => lockedKeys.has(key(p))).slice(0, count);
  let rest = landscape.filter(p => !locked.includes(p));
  if (set.shuffle) {
    // seeded shuffle so "Shuffle again" gives a new mix but re-renders while editing don't
    let x = seed * 9301 + 49297;
    const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
    rest = rest.map(p => [rnd(), p]).sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  }
  const pick = new Set([...locked, ...rest.slice(0, count - locked.length)]);
  return { shown: landscape.filter(p => pick.has(p)), count, locked: new Set(locked) };
}

/**
 * The home page for one set.
 * opts: { set, projects, categories, site, thumb(p), screen: 'desktop'|'phone', seed, onPick(p) }
 */
export function homePreview(h, opts) {
  const { set, categories, site, thumb, screen = 'desktop', seed = 0, onPick } = opts;
  const phone = screen === 'phone';
  const W = SCREENS[screen].width;
  const byKey = new Map(opts.projects.map(p => [`${p.category}/${p.id}`, p]));
  const chosen = (set.projects || []).map(k => byKey.get(k)).filter(Boolean);
  const landscape = set.showLandscape === false ? [] : chosen.filter(p => p.category !== 'vertical');
  const social = set.showSocial === false ? [] : chosen.filter(p => p.category === 'vertical');
  const feat = featuredPick(set, landscape, seed);

  // Same split as the site: hero 82% of the screen, heading 12%, then the work peeks in
  const screenH = SCREENS[screen].height;
  const hero = h('div', { class: 'pv-hero', style: `height:${opts.heroHeight || Math.max(420, Math.round(screenH * 0.82))}px` },
    h('img', { class: 'pv-hero-img', src: site.heroPoster || '/images/hero-poster.webp', alt: '' }),
    h('div', { class: 'pv-hero-text' },
      h('div', { class: 'pv-h1' }, site.title || 'Matthew Fregnan'),
      h('div', { class: 'pv-tag' }, (set.tagline || '').trim() || site.tagline || ''),
      h('span', { class: 'pv-cta' }, 'View my work')),
    landscape.length || social.length ? h('span', { class: 'pv-cue' }, '⌄') : null);

  const rows = [];
  if (feat.shown.length) {
    // A sideways row like .row-scroller.is-landscape: up to 3 share the row (phones: 1), more scroll with a peek
    const n = feat.shown.length;
    const fitAt = phone ? 1 : 3;
    const per = n <= fitAt ? (phone ? 1 : Math.max(n, 2)) : (phone ? 1.2 : 3.3);
    const tileW = `calc((100% - ${12 * (per - 1)}px) / ${per})`;
    rows.push({ kind: 'landscape', title: (set.landscapeTitle || '').trim(),
      el: h('div', { class: 'pv-social' },
        h('div', { class: 'pv-track pv-grid' }, feat.shown.map(p => {
          const t = tile(h, p, {
            thumb, onPick,
            badge: feat.count ? (feat.locked.has(p) ? { kind: 'lock', text: '🔒 Locked' } : set.shuffle ? { kind: 'shuffle', text: '⤮ Shuffled' } : null) : null,
          });
          t.style.flex = `0 0 ${tileW}`;
          return t;
        })),
        n > fitAt && !phone ? h('span', { class: 'pv-arrow' }, '›') : null) });
  }
  if (social.length) {
    const n = social.length;
    const fitAt = phone ? 2 : 5;               // what fits on this screen (see .shortform-scroller)
    const per = n <= fitAt ? (phone ? 2 : Math.max(n, 4)) : (phone ? 2.25 : 5.35);
    const tileW = `calc((100% - ${12 * (per - 1)}px) / ${per})`;
    rows.push({ kind: 'social', title: String(set.socialTitle || '').trim(),
      el: h('div', { class: 'pv-social' },
        h('div', { class: 'pv-track' }, social.map(p => {
          const t = tile(h, p, { vertical: true, thumb, onPick });
          t.style.flex = `0 0 ${tileW}`;
          return t;
        })),
        n > fitAt && !phone ? h('span', { class: 'pv-arrow' }, '›') : null) });
  }
  if (set.order === 'social-first') rows.reverse();

  const tiles = categories.map(c => {
    const pics = opts.projects.filter(p => p.category === c.id && p.thumbnail).slice(0, 1);
    return h('div', { class: 'pv-cat' },
      pics.length ? img(h, thumb(pics[0]), pics[0].thumbFocus) : null,
      h('div', {}, h('b', {}, c.name), h('small', {}, `${opts.projects.filter(p => p.category === c.id).length} projects`)));
  });

  const frame = h('div', { class: `pv-site${phone ? ' phone' : ''}` },
    nav(h, site, phone),
    hero,
    h('div', { class: 'pv-container' },
      h('div', { class: 'pv-work-head', style: `height:${Math.max(64, Math.round(screenH * 0.12))}px` },
        h('span', { class: 'pv-h2' }, (set.heading || '').trim() || 'Featured Work')),
      rows.flatMap((r, i) => [
        r.title ? h('div', { class: `pv-h3${i ? ' gap' : ''}` }, r.title) : (i ? h('div', { class: 'pv-gap' }) : null),
        r.el,
      ]),
      h('div', { class: 'pv-h3 gap' }, 'All work'),
      h('div', { class: 'pv-cats', style: `grid-template-columns:repeat(${phone ? 1 : 2},1fr)` }, tiles)));
  return scaled(h, frame, W);
}

/**
 * One project's page.
 * opts: { project, category, layout: 'standard'|'detailed', site, thumb(p), still(path), screen }
 */
export function projectPreview(h, opts) {
  const { project: p, category: c, layout = 'standard', site, thumb, still, screen = 'desktop' } = opts;
  const phone = screen === 'phone';
  const vertical = c.id === 'vertical';
  const hasVideo = !!(p.videoFile || p.vimeoId || p.youtubeId || p.instagramId || p.tiktokId);
  const player = hasVideo ? h('div', { class: `pv-player${vertical ||  ((p.instagramId || p.tiktokId) && !p.videoFile && !p.vimeoId && !p.youtubeId) ? ' v' : ''}` },
    img(h, thumb(p), p.thumbFocus),
    h('span', { class: 'pv-play' }, '▶')) : null;
  const gallery = (p.gallery || []).map(g => h('img', { class: 'pv-still', src: still(g), alt: '', loading: 'lazy' }));

  let details;
  if (layout === 'detailed') {
    const roles = String(p.role || '').split(/\s*(?:,|&|\+|·|\/)\s*/).filter(Boolean);
    const platforms = String(p.platform || '').split(/\s*(?:,|·|\/)\s*/).filter(Boolean);
    const facts = [['Client', p.client], ['Agency', p.agency], ['Production', p.production],
      ['Deliverables', p.deliverables], ['Year', p.year]].filter(([, v]) => v);
    details = p.description || roles.length || platforms.length || facts.length
      ? h('div', { class: `pv-context${phone ? ' one' : ''}` },
        h('div', {},
          p.description ? h('p', { class: 'pv-desc' }, p.description) : null,
          roles.length ? h('div', { class: 'pv-group' }, h('div', { class: 'pv-label' }, 'What I did'),
            h('div', { class: 'pv-chips' }, roles.map(r => h('span', {}, r)))) : null,
          platforms.length ? h('div', { class: 'pv-group' }, h('div', { class: 'pv-label' }, 'Made for'),
            h('div', { class: 'pv-chips quiet' }, platforms.map(r => h('span', {}, r)))) : null),
        facts.length ? h('dl', { class: 'pv-facts' }, facts.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))) : null)
      : null;
  } else {
    const facts = [['Client', p.client], ['Production', p.production], ['Role', p.role], ['Year', p.year]].filter(([, v]) => v);
    details = [
      p.description ? h('p', { class: 'pv-muted' }, p.description) : null,
      facts.length ? h('dl', { class: `pv-dl${phone ? ' one' : ''}` }, facts.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))) : null,
    ];
  }

  const stats = statsText(p);
  const title = h('div', { class: 'pv-title' }, p.title || '(untitled)');
  const client = p.client ? h('div', { class: 'pv-muted pv-client' }, p.client) : null;
  const empty = !hasVideo && !gallery.length ? h('p', { class: 'pv-muted' }, 'No video or stills yet.') : null;
  // Social projects on wider screens: video on the left sized to fit the screen, details beside it
  // (matches .portrait-page in src/styles.css)
  const portrait = vertical && !phone && player;
  if (portrait) player.style.width = `${Math.min(420, (SCREENS[screen].height - 220) * 9 / 16)}px`;
  const frame = h('div', { class: `pv-site${phone ? ' phone' : ''}` },
    nav(h, site, phone, c.name),
    h('div', { class: 'pv-page' },
      h('div', { class: 'pv-back' }, `‹  Back to ${c.name}`),
      portrait
        ? h('div', { class: 'pv-portrait' }, h('div', {}, player, stats ? h('div', { class: 'pv-stats', style: 'margin:12px 0 0' }, stats) : null),
          h('div', {}, title, client, h('div', { class: 'pv-one' }, details), gallery.length ? h('div', { class: 'pv-gallery' }, gallery) : null))
        : [title, client, player, stats && player ? h('div', { class: 'pv-stats' }, stats) : null, gallery.length ? h('div', { class: 'pv-gallery' }, gallery) : null, details, empty]));
  return scaled(h, frame, SCREENS[screen].width);
}

/** The project's tile as it appears in lists on the site (category page and home page). */
export function cardPreview(h, p, thumb) {
  return h('div', { class: 'pv-card-demo' }, tile(h, p, { vertical: p.category === 'vertical', thumb }));
}

const PLATFORM_NAMES = { youtube: 'YouTube', vimeo: 'Vimeo', instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', linkedin: 'LinkedIn', x: 'X' };

/** Typed views/likes/comments as the site shows them (live YouTube/Vimeo counts only appear on the site). */
export function statsText(p) {
  if (!p.showStats) return '';
  const num = v => {
    const m = String(v ?? '').trim().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([kmb])?$/i);
    return m ? Math.round(parseFloat(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1)) : null;
  };
  const fmt = new Intl.NumberFormat('en-AU', { notation: 'compact', maximumFractionDigits: 1 });
  const part = (n, w) => (n ? `${fmt.format(n)} ${w}${n === 1 ? '' : 's'}` : '');
  const text = [part(num(p.statsViews), 'view'), part(num(p.statsLikes), 'like'), part(num(p.statsComments), 'comment')].filter(Boolean).join(' · ');
  if (!text) return '';
  const where = PLATFORM_NAMES[p.statsPlatform ?? (p.instagramId ? 'instagram' : p.tiktokId ? 'tiktok' : '')];
  return where ? `${text} on ${where}` : text;
}
