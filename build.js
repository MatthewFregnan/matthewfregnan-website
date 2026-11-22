const fs = require('fs-extra');
const path = require('path');
const ejs = require('ejs');
const { execSync } = require('child_process');
const sharp = require('sharp');

// Paths
const DIST_DIR = path.join(__dirname, 'dist');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const DATA_DIR = path.join(__dirname, 'data');
const IMAGES_DIR = path.join(__dirname, 'images');
const SRC_DIR = path.join(__dirname, 'src');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Load data
function loadData() {
  const projectsPath = path.join(DATA_DIR, 'projects.json');
  const siteConfigPath = path.join(DATA_DIR, 'site.json');

  const projects = fs.existsSync(projectsPath)
    ? JSON.parse(fs.readFileSync(projectsPath, 'utf8'))
    : { categories: [], projects: [] };

  const siteConfig = fs.existsSync(siteConfigPath)
    ? JSON.parse(fs.readFileSync(siteConfigPath, 'utf8'))
    : {
        title: 'Matthew Fregnan',
        tagline: 'Melbourne-based Video Editor & Colourist',
        email: 'matthewfregnan@outlook.com',
        location: 'Melbourne, Australia'
      };

  projects.projects.forEach(normaliseProject);
  // Hidden projects (hidden in the admin's Pages screen) keep their entry but aren't on the site;
  // their page address forwards to their section page (see generateRedirects).
  projects.hiddenProjects = projects.projects.filter(p => p.hidden);
  projects.projects = projects.projects.filter(p => !p.hidden);
  if (projects.hiddenProjects.length) console.log(`  Hidden projects (not on the site): ${projects.hiddenProjects.length}`);
  return { projects, siteConfig };
}

// The web admin (/admin) and the desktop app may store values slightly differently:
// full links instead of IDs, and image paths with or without the /images/... prefix.
// Tidy everything into one shape before building.
function normaliseProject(p) {
  const strip = (v, prefix) => (typeof v === 'string' && v.startsWith(prefix) ? v.slice(prefix.length) : v);
  p.thumbnail = strip(p.thumbnail || '', '/images/thumbnails/');
  if (Array.isArray(p.gallery)) p.gallery = p.gallery.filter(Boolean).map(g => strip(g, '/images/gallery/'));

  const vimeo = String(p.vimeoId || '').trim();
  if (vimeo && !/^\d+$/.test(vimeo)) {
    const m = vimeo.match(/vimeo\.com\/(?:.*\/)?(\d{5,})(?:\/([0-9a-f]{6,}))?/);
    const h = vimeo.match(/[?&]h=([0-9a-f]+)/);
    p.vimeoId = m ? m[1] : '';
    if (m && (m[2] || h)) p.vimeoHash = m[2] || h[1];
  }
  const yt = String(p.youtubeId || '').trim();
  if (yt && !/^[\w-]{11}$/.test(yt)) {
    const m = yt.match(/(?:[?&]v=|youtu\.be\/|\/(?:embed|shorts|live)\/)([\w-]{11})/);
    p.youtubeId = m ? m[1] : '';
  }
  const ig = String(p.instagramId || '').trim();
  if (ig.includes('/')) {
    const m = ig.match(/instagram\.com\/(?:p|reels?|tv)\/([\w-]+)/);
    p.instagramId = m ? m[1] : '';
  }
  const tt = String(p.tiktokId || '').trim();
  if (tt && !/^\d{15,}$/.test(tt)) {
    const m = tt.match(/\/(?:video|v2|v1|v)\/(\d{15,})/);
    const u = tt.match(/\/@([\w.-]+)/);
    p.tiktokId = m ? m[1] : '';
    if (u && !p.tiktokUser) p.tiktokUser = u[1];
  }
  if (!p.id) {
    p.id = String(p.title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
}

// SEO Helper Functions
function buildPersonSchema(siteConfig) {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "name": siteConfig.title,
    "jobTitle": "Video Editor & Colourist",
    "description": siteConfig.seo.defaultDescription,
    "url": siteConfig.domain,
    "email": siteConfig.email,
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Melbourne",
      "addressRegion": "VIC",
      "addressCountry": "AU"
    },
    "sameAs": [
      siteConfig.social.vimeo,
      siteConfig.social.linkedin
    ],
    "knowsAbout": ["Video Editing", "Colour Grading", "Post Production", "Commercial Video", "Branded Content"]
  };
}

function buildLocalBusinessSchema(siteConfig) {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${siteConfig.domain}/#business`,
    "name": `${siteConfig.title} - Video Editor`,
    "description": "Professional video editing and colour grading services in Melbourne",
    "url": siteConfig.domain,
    "email": siteConfig.email,
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Melbourne",
      "addressRegion": "VIC",
      "addressCountry": "AU"
    },
    "areaServed": {
      "@type": "GeoCircle",
      "geoMidpoint": {
        "@type": "GeoCoordinates",
        "latitude": -37.8136,
        "longitude": 144.9631
      }
    },
    "priceRange": "$$"
  };
}

// ---------------------------------------------------------------- Video sources
// A project can have its own hosted video file (videos.matthewfregnan.com, played in the site's
// custom player: no ads or branding) plus Vimeo, YouTube, Instagram and TikTok links as backups.
// `videoPrimary` picks which shows first. The build checks which actually play and starts on the
// first working one; src/main.js swaps to a backup in the visitor's browser if one breaks later.
const SOURCE_ORDER = ['file', 'vimeo', 'youtube', 'instagram', 'tiktok'];

function videoSources(project) {
  const all = {};
  if (project.videoFile) {
    const url = String(project.videoFile).trim();
    all.file = { kind: 'file', id: url, page: url, embed: url, check: null, head: url };
  }
  if (project.vimeoId) {
    const h = project.vimeoHash ? `h=${project.vimeoHash}&` : '';
    const page = `https://vimeo.com/${project.vimeoId}${project.vimeoHash ? `/${project.vimeoHash}` : ''}`;
    all.vimeo = {
      kind: 'vimeo', id: project.vimeoId, page,
      embed: `https://player.vimeo.com/video/${project.vimeoId}?${h}title=0&byline=0&portrait=0`,
      check: `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(page)}`
    };
  }
  if (project.youtubeId) {
    const page = `https://www.youtube.com/watch?v=${project.youtubeId}`;
    all.youtube = {
      kind: 'youtube', id: project.youtubeId, page,
      embed: `https://www.youtube-nocookie.com/embed/${project.youtubeId}?rel=0&playsinline=1`,
      check: `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(page)}`
    };
  }
  if (project.instagramId) {
    all.instagram = {
      kind: 'instagram', id: project.instagramId,
      page: `https://www.instagram.com/p/${project.instagramId}/`,
      embed: `https://www.instagram.com/p/${project.instagramId}/embed/`,
      check: null // Instagram can't be checked without a Meta API token
    };
  }
  if (project.tiktokId) {
    const page = `https://www.tiktok.com/@${project.tiktokUser || ''}/video/${project.tiktokId}`;
    all.tiktok = {
      kind: 'tiktok', id: project.tiktokId, page,
      embed: `https://www.tiktok.com/player/v1/${project.tiktokId}?music_info=1&description=1&rel=0`,
      check: null // TikTok's oEmbed answers OK even for videos that don't exist, so it can't be verified
    };
  }
  return SOURCE_ORDER
    .slice()
    .sort((a, b) => (b === project.videoPrimary) - (a === project.videoPrimary))
    .filter(k => all[k])
    .map(k => all[k]);
}

// true = plays, false = definitely broken, null = couldn't tell (offline etc.; treat as fine)
async function sourcePlays(source) {
  const url = source.head || source.check;
  if (!url || process.env.SKIP_VIDEO_CHECK) return null;
  try {
    const res = await fetch(url, { method: source.head ? 'HEAD' : 'GET', signal: AbortSignal.timeout(8000) });
    if (res.ok) return true;
    return [400, 401, 403, 404].includes(res.status) ? false : null;
  } catch {
    return null;
  }
}

async function resolveVideos(projects) {
  const results = await mapLimit(projects, 8, async (project) => {
    const sources = videoSources(project);
    let active = 0;
    for (let i = 0; i < sources.length; i++) {
      if ((await sourcePlays(sources[i])) !== false) { active = i; break; }
      if (i === sources.length - 1) active = 0; // nothing plays: keep the first choice
    }
    if (sources.length && active > 0) {
      console.warn(`  ${project.id}: ${sources[0].kind} isn't playing, using ${sources[active].kind} backup`);
    }
    return { sources, active };
  });
  projects.forEach((p, i) => { p._video = results[i]; });
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

// ---------------------------------------------------------------- View counts
// Fetched at build time so API keys stay secret (GitHub Actions secrets). The deploy workflow
// rebuilds daily, so counts are at most a day old. Without keys, no counts are shown.
const compact = new Intl.NumberFormat('en-AU', { notation: 'compact', maximumFractionDigits: 1 });

async function fetchStats(projects) {
  const wanted = projects.filter(p => p.showStats && p._video && p._video.sources.length);
  const yt = wanted.filter(p => p._video.sources[p._video.active].kind === 'youtube');
  const vm = wanted.filter(p => p._video.sources[p._video.active].kind === 'vimeo');
  const ytKey = process.env.YOUTUBE_API_KEY;
  const vmToken = process.env.VIMEO_TOKEN;

  if (yt.length && ytKey) {
    for (let i = 0; i < yt.length; i += 50) {
      const batch = yt.slice(i, i + 50);
      const ids = [...new Set(batch.map(p => p.youtubeId))].join(',');
      try {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids}&key=${ytKey}`,
          { signal: AbortSignal.timeout(10000) });
        const json = await res.json();
        for (const item of json.items || []) {
          const views = Number(item.statistics.viewCount || 0);
          const likes = Number(item.statistics.likeCount || 0);
          batch.filter(x => x.youtubeId === item.id).forEach(p => { p._stats = { kind: 'youtube', views, likes }; });
        }
      } catch (e) {
        console.warn('  Couldn\'t fetch YouTube stats:', e.message);
      }
    }
  } else if (yt.length) {
    console.warn('  YOUTUBE_API_KEY not set: skipping YouTube view counts');
  }

  if (vm.length && vmToken) {
    await mapLimit(vm, 4, async (p) => {
      try {
        const res = await fetch(`https://api.vimeo.com/videos/${p.vimeoId}?fields=stats.plays,metadata.connections.likes.total`, {
          headers: { Authorization: `bearer ${vmToken}` }, signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) return;
        const json = await res.json();
        const views = json.stats && json.stats.plays;
        if (views != null) {
          p._stats = { kind: 'vimeo', views, likes: json.metadata?.connections?.likes?.total || 0 };
        }
      } catch (e) {
        console.warn(`  Couldn't fetch Vimeo stats for ${p.id}:`, e.message);
      }
    });
  } else if (vm.length) {
    console.warn('  VIMEO_TOKEN not set: skipping Vimeo view counts');
  }

  // Numbers typed in the editor (any platform, e.g. a client's Instagram post) win over live counts
  for (const p of projects) {
    if (!p.showStats) continue;
    const typed = { views: parseCount(p.statsViews), likes: parseCount(p.statsLikes), comments: parseCount(p.statsComments) };
    if (typed.views == null && typed.likes == null && typed.comments == null) continue;
    p._stats = { kind: p.statsPlatform ?? (p.instagramId ? 'instagram' : p.tiktokId ? 'tiktok' : ''), ...typed, typed: true };
  }

  for (const p of projects) {
    if (!p._stats) continue;
    const s = p._stats;
    const part = (n, word) => (n ? `${compact.format(n)} ${word}${n === 1 ? '' : 's'}` : '');
    s.text = [part(s.views, 'view'), part(s.likes, 'like'), part(s.comments, 'comment')].filter(Boolean).join(' · ');
    // one line per number on the project page (partials/stats-fact.ejs)
    s.lines = [[s.views, 'view'], [s.likes, 'like'], [s.comments, 'comment']].filter(([n]) => n)
      .map(([n, word]) => ({ n: compact.format(n), word: `${word}${n === 1 ? '' : 's'}`, kind: word }));
    s.where = STATS_PLATFORMS[s.kind] || '';
    // "on Instagram" etc. links to the post when the project has that platform's link
    s.link = (p._video?.sources || []).find(src => src.kind === s.kind)?.page || '';
    if (!s.text) delete p._stats;
  }
}

const STATS_PLATFORMS = {
  youtube: 'YouTube', vimeo: 'Vimeo', instagram: 'Instagram', tiktok: 'TikTok',
  facebook: 'Facebook', linkedin: 'LinkedIn', x: 'X',
};

/** "1.2M", "45K", "45,000", "320" -> a number (null if empty or not a number). */
function parseCount(v) {
  const m = String(v ?? '').trim().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([kmb])?$/i);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
  return Math.round(parseFloat(m[1]) * mult);
}

function buildVideoSchema(project, category, siteConfig) {
  const video = project._video;
  if (!video || !video.sources.length) return null;
  const source = video.sources[video.active];
  const videoUrl = source.page;
  const embedUrl = source.embed;

  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "name": project.title,
    "description": project.description || `${category.name} project: ${project.title}${project.client ? ` for ${project.client}` : ''}`,
    "thumbnailUrl": `${siteConfig.domain}${ogImagePath(project)}`,
    "contentUrl": videoUrl,
    "embedUrl": embedUrl,
    "creator": {
      "@type": "Person",
      "name": siteConfig.title
    },
    ...(project._stats && project._stats.views && {
      "interactionStatistic": {
        "@type": "InteractionCounter",
        "interactionType": { "@type": "WatchAction" },
        "userInteractionCount": project._stats.views
      }
    }),
    ...(project.production && {
      "productionCompany": {
        "@type": "Organization",
        "name": project.production
      }
    })
  };
}

function buildItemListSchema(category, categoryProjects, siteConfig) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": `${category.name} Portfolio`,
    "description": `${category.name} video editing and post-production work by ${siteConfig.title}`,
    "numberOfItems": categoryProjects.length,
    "itemListElement": categoryProjects.map((project, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "url": `${siteConfig.domain}/${category.slug}/${project.id}/`
    }))
  };
}

// Social share images: link previews (LinkedIn, Facebook etc.) are most reliable
// with JPEG, so make a 1200px JPEG copy of each WebP thumbnail.
function ogImagePath(project) {
  return `/images/og/${project.category}/${project.id}.jpg`;
}

async function ensureFile(file) {
  await fs.ensureDir(path.dirname(file));
  return file;
}

async function generateOgImages(projects) {
  for (const project of projects.projects) {
    if (!project.thumbnail) continue;
    const src = path.join(IMAGES_DIR, 'thumbnails', project.thumbnail);
    if (!(await fs.pathExists(src))) {
      console.warn(`  Missing thumbnail for ${project.id}: ${project.thumbnail}`);
      continue;
    }
    await sharp(src)
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#000000' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(await ensureFile(path.join(DIST_DIR, ogImagePath(project))));
  }
  console.log('Generated social share images');
}

// Category descriptions for SEO
const categoryDescriptions = {
  'commercial': 'Commercial video editing portfolio featuring campaigns for KIA, Oporto, Department of Education, and government agencies by Melbourne editor Matthew Fregnan.',
  'branded': 'Branded content video editing - corporate videos for Deakin University, TAB, DSS, and more by Melbourne-based editor Matthew Fregnan.',
  'vertical': 'Social video editing - short-form vertical content for TikTok, Instagram and YouTube Shorts for KIA, VCAA, CRKD and RS Rewards by Melbourne editor Matthew Fregnan.',
  'colour-grading': 'Professional colour grading portfolio featuring film and commercial colour work including music videos and short films by Melbourne colourist Matthew Fregnan.'
};

// Old addresses that moved, so links people already have keep working:
// /<from>/ and /<from>/<project>/ redirect to the same page under /<to>/.
const MOVED_SECTIONS = { vertical: 'social' };

function redirectPage(target, siteConfig) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Moved</title><meta name="robots" content="noindex">
<link rel="canonical" href="${siteConfig.domain}${target}">
<meta http-equiv="refresh" content="0; url=${target}">
<script>location.replace(${JSON.stringify(target)} + location.hash)</script>
</head><body><p>This page has moved to <a href="${target}">${siteConfig.domain}${target}</a>.</p></body></html>`;
}

async function generateRedirects(projects, siteConfig) {
  // Projects whose page address (or section) changed: the old address forwards to the new one,
  // unless another project now lives there.
  const slugOf = id => (projects.categories.find(c => c.id === id) || {}).slug || id;
  const live = new Set(projects.projects.map(p => `${p.category}/${p.id}`));
  let moved = 0;
  for (const p of projects.projects) {
    for (const old of p.formerAddresses || []) {
      if (live.has(old)) continue;
      const [cat, id] = old.split('/');
      if (!cat || !id || !/^[a-z0-9-]+$/.test(id)) continue;
      const target = `/${slugOf(p.category)}/${p.id}/`;
      await fs.outputFile(path.join(DIST_DIR, slugOf(cat), id, 'index.html'), redirectPage(target, siteConfig));
      moved += 1;
    }
  }
  if (moved) console.log(`  Redirects for renamed projects: ${moved}`);

  for (const p of projects.hiddenProjects || []) {
    if (live.has(`${p.category}/${p.id}`) || !/^[a-z0-9-]+$/.test(p.id || '')) continue;
    await fs.outputFile(path.join(DIST_DIR, slugOf(p.category), p.id, 'index.html'), redirectPage(`/${slugOf(p.category)}/`, siteConfig));
  }

  for (const [from, to] of Object.entries(MOVED_SECTIONS)) {
    const category = projects.categories.find(c => c.slug === to);
    if (!category) continue;
    const pages = [''].concat(projects.projects.filter(p => p.category === category.id).map(p => `${p.id}/`));
    for (const page of pages) {
      const target = `/${to}/${page}`;
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Moved</title><meta name="robots" content="noindex">
<link rel="canonical" href="${siteConfig.domain}${target}">
<meta http-equiv="refresh" content="0; url=${target}">
<script>location.replace(${JSON.stringify(target)} + location.hash)</script>
</head><body><p>This page has moved to <a href="${target}">${siteConfig.domain}${target}</a>.</p></body></html>`;
      await fs.outputFile(path.join(DIST_DIR, from, page, 'index.html'), html);
    }
  }
}

// Generate sitemap.xml
async function generateSitemap(projects, siteConfig) {
  const domain = siteConfig.domain;
  const today = new Date().toISOString().split('T')[0];

  let urls = [
    { loc: '/', priority: '1.0', changefreq: 'weekly' },
    { loc: '/about/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/my-work/', priority: '0.9', changefreq: 'weekly' }
  ];

  // Add category pages
  for (const category of projects.categories) {
    urls.push({
      loc: `/${category.slug}/`,
      priority: '0.8',
      changefreq: 'weekly'
    });

    // Add project pages
    const categoryProjects = projects.projects.filter(p => p.category === category.id);
    for (const project of categoryProjects) {
      urls.push({
        loc: `/${category.slug}/${project.id}/`,
        priority: '0.6',
        changefreq: 'monthly'
      });
    }
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => `  <url>
    <loc>${domain}${url.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  await fs.outputFile(path.join(DIST_DIR, 'sitemap.xml'), sitemap);
  console.log('Generated sitemap.xml');
}

// Generate robots.txt
async function generateRobotsTxt(siteConfig) {
  const robotsTxt = `User-agent: *
Allow: /
Disallow: /admin/

Sitemap: ${siteConfig.domain}/sitemap.xml`;

  await fs.outputFile(path.join(DIST_DIR, 'robots.txt'), robotsTxt);
  console.log('Generated robots.txt');
}

function fileHash(file) {
  try {
    return require('crypto').createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
  } catch {
    return String(Date.now());
  }
}

// Render template
async function renderTemplate(templateName, data) {
  const templatePath = path.join(TEMPLATES_DIR, `${templateName}.ejs`);
  const template = await fs.readFile(templatePath, 'utf8');
  return ejs.render(template, { focusOf, logoOf, logoPosition, imageUrl, ...data }, { filename: templatePath });
}

// Build CSS with Tailwind
function buildCSS() {
  console.log('Building CSS with Tailwind...');
  const inputPath = path.join(SRC_DIR, 'styles.css');
  const outputPath = path.join(DIST_DIR, 'css', 'styles.css');

  fs.ensureDirSync(path.dirname(outputPath));

  try {
    execSync(`npx tailwindcss -i "${inputPath}" -o "${outputPath}" --minify`, {
      stdio: 'inherit'
    });
  } catch (error) {
    console.error('Error building CSS:', error.message);
    process.exit(1);
  }
}

// Copy static assets
async function copyAssets() {
  console.log('Copying static assets...');

  // Copy public folder contents to dist root (favicon, manifest, icons, etc.)
  if (await fs.pathExists(PUBLIC_DIR)) {
    await fs.copy(PUBLIC_DIR, DIST_DIR);
  }
  await fingerprintAdmin();

  // Copy images
  if (await fs.pathExists(IMAGES_DIR)) {
    await fs.copy(IMAGES_DIR, path.join(DIST_DIR, 'images'));
  }

  // Copy JS
  const jsPath = path.join(SRC_DIR, 'main.js');
  if (await fs.pathExists(jsPath)) {
    await fs.ensureDir(path.join(DIST_DIR, 'js'));
    await fs.copy(jsPath, path.join(DIST_DIR, 'js', 'main.js'));
  }

  // Copy CNAME if exists
  const cnamePath = path.join(__dirname, 'CNAME');
  if (await fs.pathExists(cnamePath)) {
    await fs.copy(cnamePath, path.join(DIST_DIR, 'CNAME'));
  }
}

// The admin page loads its stylesheet and scripts (and the scripts import each other).
// Stamp every one of those links with a fingerprint of the admin's files, so a browser or
// Cloudflare can never keep running an old copy after an update.
async function fingerprintAdmin() {
  const dir = path.join(DIST_DIR, 'admin');
  if (!(await fs.pathExists(dir))) return;
  const jsDir = path.join(dir, 'js');
  const jsFiles = (await fs.pathExists(jsDir)) ? (await fs.readdir(jsDir)).filter(f => f.endsWith('.js')) : [];
  const hash = require('crypto').createHash('sha1');
  for (const f of ['index.html', 'admin.css', ...jsFiles.map(f => `js/${f}`)].sort()) {
    const file = path.join(dir, f);
    if (await fs.pathExists(file)) hash.update(f).update(await fs.readFile(file));
  }
  const v = hash.digest('hex').slice(0, 10);
  for (const f of jsFiles) {
    const file = path.join(jsDir, f);
    const src = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, src.replace(/(from\s+['"]\.\/[\w-]+\.js)(['"])/g, `$1?v=${v}$2`));
  }
  const indexFile = path.join(dir, 'index.html');
  const html = await fs.readFile(indexFile, 'utf8');
  await fs.writeFile(indexFile, html
    .replace('href="admin.css"', `href="admin.css?v=${v}"`)
    .replace('src="js/app.js"', `src="js/app.js?v=${v}"`));
}

// "All work" tiles on the home page: one per category, with a project count and up to four
// pictures that slowly cycle. Pictures favour projects in the live set, then the rest of the
// category in order, one per client so the cycle shows range.
// A project's thumbnail focus point ("x% y%"), set by clicking the thumbnail in the app or
// admin. Crops keep this point in view. Defaults to the centre.
// Client logos (optional): "clients" in projects.json, e.g. { "KIA": { "logo": "kia.webp" } }, files in
// images/logos. Shown small on that client's thumbnails (see partials/card.ejs).
const CLIENT_LOGOS = new Map();
// Where logos sit on the tiles, chosen per home page set ("logoPosition" in home.json):
// corner (default), title-right, title-right-faint, title-left, or none.
const LOGO_POSITIONS = ['corner', 'title-right', 'title-right-faint', 'title-left', 'none'];
let LOGO_POSITION = 'corner';
const logoPosition = () => LOGO_POSITION;
function logoOf(p) {
  if (LOGO_POSITION === 'none') return '';
  const file = CLIENT_LOGOS.get(String(p.client || '').trim().toLowerCase());
  if (!file || !fs.existsSync(path.join(IMAGES_DIR, 'logos', file))) return '';
  // the white copy made by makeWhiteLogos, versioned by the original file
  return imageUrl('logos', file).replace('/images/logos/', '/images/logos-white/');
}

// The logo strip in the home page hero. Clients ticked "Show in the home page logo strip" in the admin
// ("strip": true in projects.json "clients"); if none are ticked, these well-known ones.
// Clients in order of importance: the strip starts with the first. Every logo is shown the same way
// (same brightness, sized by shape for equal weight); only the order changes. Clients not listed go after these.
const CLIENT_RANK = [
  'RedOctane Games', 'CRKD', 'KIA', 'Deakin University',
  'Ladbrokes', 'Toni and Ryan', 'Oporto', 'TAB',
  "Royal Children's Hospital", 'Victorian Government', 'PTV', 'Yarra Valley Water',
];
const STRIP_DEFAULT = CLIENT_RANK;
const LOGO_ASPECT = new Map();   // logo file -> width / height, filled by makeWhiteLogos
// stripOrder: home.json "clientStrip", the clients shown and their order, set on the admin's Home Page screen.
function clientLogos(projects, clients = {}, stripOrder = null) {
  let names;
  if (Array.isArray(stripOrder)) {
    names = stripOrder.map(n => String(n).trim().toLowerCase());
  } else {   // older setup: ticked clients (or the defaults), in CLIENT_RANK order
    const ticked = Object.entries(clients).filter(([, c]) => c && c.strip).map(([n]) => n);
    const rank = n => { const i = CLIENT_RANK.findIndex(r => r.toLowerCase() === n); return i < 0 ? 999 : i; };
    names = (ticked.length ? ticked : STRIP_DEFAULT).map(n => n.trim().toLowerCase()).sort((a, b) => rank(a) - rank(b));
  }
  const seen = new Map();
  for (const name of names) {
    const file = CLIENT_LOGOS.get(name);
    if (!file || seen.has(file) || !fs.existsSync(path.join(IMAGES_DIR, 'logos', file))) continue;
    // the full logo (icon and name) when there is one in images/logos/full
    const rel = fs.existsSync(path.join(IMAGES_DIR, 'logos', 'full', file)) ? `full/${file}` : file;
    // Size by shape so every logo has about the same presence: wide wordmarks shorter, stacked ones taller
    const aspect = LOGO_ASPECT.get(rel) || 3;
    const height = Math.round(Math.min(56, Math.max(26, Math.sqrt(5200 / aspect))) * 0.9);
    const client = Object.keys(clients).find(n => n.trim().toLowerCase() === name) || name;
    seen.set(file, { src: imageUrl('logos', rel).replace('/images/logos/', '/images/logos-white/'), name: client, height });
  }
  return [...seen.values()];
}

// Logos show white on the tiles. Bake that into white copies (dist/images/logos-white) instead of a
// CSS colour filter, which some browsers drop while the tile animates (the logo flashed black).
async function makeWhiteLogos() {
  let made = 0;
  const files = [...new Set(CLIENT_LOGOS.values())];
  for (const file of [...files, ...files.map(f => `full/${f}`)]) {
    const src = path.join(IMAGES_DIR, 'logos', file);
    if (!fs.existsSync(src)) continue;
    const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; }
    const out = path.join(DIST_DIR, 'images', 'logos-white', file);
    await fs.ensureDir(path.dirname(out));
    await sharp(data, { raw: info }).webp({ quality: 92, alphaQuality: 100 }).toFile(out);
    LOGO_ASPECT.set(file, info.width / info.height);
    made += 1;
  }
  if (made) console.log(`  White client logos: ${made}`);
}

// Image URLs carry a short hash of the file (?v=...), so replacing an image under the same
// name (e.g. a new thumbnail) shows straight away instead of the browser/Cloudflare's old copy.
const IMAGE_HASHES = new Map();
function imageUrl(kind, file) {
  if (!file) return '';
  const full = path.join(IMAGES_DIR, kind, file);
  if (!IMAGE_HASHES.has(full)) IMAGE_HASHES.set(full, fs.existsSync(full) ? fileHash(full).slice(0, 8) : '');
  const v = IMAGE_HASHES.get(full);
  return `/images/${kind}/${file}${v ? `?v=${v}` : ''}`;
}

function focusOf(p) {
  const m = /^(\d{1,3}(?:\.\d+)?)% (\d{1,3}(?:\.\d+)?)%$/.exec(String(p.thumbFocus || '').trim());
  return m ? `${Math.min(100, +m[1])}% ${Math.min(100, +m[2])}%` : '';
}

// Thumbnails with black bars baked in (pillarbox/letterbox) look broken when cropped into the
// wide section tiles, so those are skipped there. Filled in by findBarredThumbnails() at build.
const barredThumbs = new Set();

async function findBarredThumbnails(projects) {
  for (const p of projects.projects) {
    if (!p.thumbnail) continue;
    const file = path.join(IMAGES_DIR, 'thumbnails', p.thumbnail);
    try {
      // Small greyscale copy; a band is "black" if every pixel in it is near black
      const { data, info } = await sharp(file).resize(160, 160, { fit: 'fill' }).greyscale().raw()
        .toBuffer({ resolveWithObject: true });
      const W = info.width, H = info.height, band = 4;
      const dark = (x0, x1, y0, y1) => {
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[y * W + x] > 24) return false;
        return true;
      };
      const sides = dark(0, band, 0, H) && dark(W - band, W, 0, H);
      const topBottom = dark(0, W, 0, band) && dark(0, W, H - band, H);
      if (sides || topBottom) barredThumbs.add(p.thumbnail);
    } catch { /* unreadable thumbnail: leave it to the normal pages */ }
  }
  if (barredThumbs.size) console.log(`  Skipping ${barredThumbs.size} thumbnails with black bars in the section tiles`);
}

function categoryTiles(projects, set) {
  const inSet = new Set((set && set.projects) || []);
  return projects.categories.map(category => {
    const items = projects.projects.filter(p => p.category === category.id && p.thumbnail && !barredThumbs.has(p.thumbnail));
    const ordered = items.filter(p => inSet.has(`${p.category}/${p.id}`)).concat(items.filter(p => !inSet.has(`${p.category}/${p.id}`)));
    const thumbs = [];
    const clients = new Set();
    for (const p of ordered) {
      const client = (p.client || p.id).toLowerCase();
      if (clients.has(client)) continue;
      clients.add(client);
      thumbs.push({ src: p.thumbnail, focus: focusOf(p) });
      if (thumbs.length === 4) break;
    }
    const count = projects.projects.filter(p => p.category === category.id).length;
    return { category, count, thumbs };
  });
}

// The home page shows whichever set of projects is marked "active" in data/home.json.
// Sets are chosen and edited in the desktop app or the web admin.
// Section page layouts (data/home.json "sections"): saved orders (presets) for a section's page,
// e.g. a gaming-first Social page. { vertical: { active: 'gaming', presets: [{ id, name, order: [ids] }] } }
// No active preset = the normal project order.
function readSectionLayouts() {
  const file = path.join(DATA_DIR, 'home.json');
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).sections || {}; } catch { return {}; }
}

function orderForSection(list, layout) {
  const preset = layout && (layout.presets || []).find(p => p.id === layout.active);
  if (!preset) return list;
  const rank = new Map((preset.order || []).map((id, i) => [id, i]));
  // projects the preset doesn't mention (added later) go after, in their normal order
  const placed = list.filter(p => rank.has(p.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
  console.log(`  ${list[0]?.category || ''} page: "${preset.name}" layout`);
  return [...placed, ...list.filter(p => !rank.has(p.id))];
}

// Words on the site you can change in the admin (Site Text screen), saved in home.json under "text".
// Anything left empty uses these.
const SITE_TEXT = {
  heroButton: 'View My Work',
  aboutHeading: 'Hi, I’m Matthew!',
  aboutBody: 'I\'m a post-production professional with over 5 years of experience based in Melbourne, Australia. I specialize in editing diverse content types, from commercial campaigns to branded videos and social media content.\n\nMy portfolio includes work with major brands such as KIA, Redoctane Games, CRKD, Deakin University, Ladbrokes, Oporto, and Australian government agencies. I focus on creating content that tells a story with clarity, energy, and style.',
  education: 'Bachelor of Film and Television (Honours) | Swinburne University · 2018–2019\nAdvanced Diploma & Diploma of Screen and Media | Swinburne University · 2016–2017',
  aboutCta: 'See my commercial work',
  homeAboutTitle: 'Hi, I’m Matthew!',
  homeAboutText: 'A Melbourne-based video editor & colourist. More about me, and how to get in touch.',
  homeAboutButton: 'More about me',
  clientsLabel: 'Clients include',
  ctaHeading: 'Have a project in mind?',
  ctaText: 'I edit and colour commercials, branded content and social. Let’s make something together.',
  ctaButton: 'Get in touch',
  contactHeading: 'Let’s work together',
  contactText: 'Tell me a bit about the project: what it is, when it’s due and where it’ll live.',
  availability: '',
  // one line under each section page's heading (key: intro_<section id>)
  'intro_commercial': 'TV and online campaigns for brands, agencies and government.',
  'intro_branded': 'Stories, profiles and series made with organisations and brands.',
  'intro_vertical': 'Short-form for TikTok, Instagram and YouTube Shorts.',
  'intro_colour-grading': 'Grading for commercials, music videos and short films.',
};
function readHomeFile() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'home.json'), 'utf8')); } catch { return {}; }
}
function readSiteText() {
  const file = path.join(DATA_DIR, 'home.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')).text || {}; } catch { /* defaults */ }
  const text = { ...SITE_TEXT };
  for (const [k, v] of Object.entries(saved)) if (k in text && String(v || '').trim()) text[k] = String(v).trim();
  for (const k of Object.keys(text)) if (text[k] === '-') text[k] = '';   // "-" hides a line (e.g. the logo label, a section intro)
  // paragraphs (blank-line separated) and "Course | Where · When" lines, ready for the templates
  text.aboutParagraphs = text.aboutBody.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  text.educationItems = text.education.split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => { const [title, ...rest] = l.split('|'); return { title: title.trim(), detail: rest.join('|').trim() }; });
  return text;
}

// "More work" at the bottom of a project page: the next project in the section (looping round), and
// three tiles: same client first, then the projects that follow in the section's order.
function moreWork(project, list, category) {
  if (list.length < 2) return null;
  const i = list.indexOf(project);
  const after = [...list.slice(i + 1), ...list.slice(0, i)];   // the section's order, starting after this one
  const key = p => String(p.client || '').trim().toLowerCase();
  const sameClient = key(project) ? after.filter(p => key(p) === key(project)) : [];
  const tiles = [...sameClient, ...after.filter(p => !sameClient.includes(p))].slice(0, 3);
  const fromClient = sameClient.length >= 2 || (sameClient.length && sameClient.length >= tiles.length);
  return {
    next: after[0],
    tiles,
    heading: fromClient ? `More from ${project.client.trim()}` : `More ${category.name} work`,
  };
}

// A home page set's tailored-link name: /for/<name>/ (its "link" if set in the admin, else from its name)
const setLinkName = set => String(set.link || set.name || set.id || '').toLowerCase().normalize('NFKD')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || set.id;

// setId: build the home page for that set (tailored links) instead of the one that's on the site
function resolveHome(projects, setId = null) {
  const file = path.join(DATA_DIR, 'home.json');
  const empty = { tagline: '', projectLayout: 'standard', landscape: [], vertical: [], categoryTiles: categoryTiles(projects, null) };
  if (!fs.existsSync(file)) return empty;
  const home = JSON.parse(fs.readFileSync(file, 'utf8'));
  const set = (home.sets || []).find(s => s.id === (setId || home.active)) || (home.sets || [])[0];
  if (!set) return empty;
  const byKey = new Map(projects.projects.map(p => [`${p.category}/${p.id}`, p]));
  const out = {
    tagline: set.tagline || '',
    projectLayout: set.projectLayout || 'standard',
    logoPosition: LOGO_POSITIONS.includes(set.logoPosition) ? set.logoPosition : 'corner',
    // How the selected work section looks for this set (all optional, see the Home Page editor)
    heading: (set.heading || '').trim() || 'Featured Work',
    order: set.order === 'social-first' ? 'social-first' : 'landscape-first',
    landscapeTitle: (set.landscapeTitle || '').trim(),
    socialTitle: String(set.socialTitle || '').trim(),
    showLandscape: set.showLandscape !== false,
    showSocial: set.showSocial !== false,
    landscape: [],
    vertical: [],
  };
  for (const key of set.projects || []) {
    const project = byKey.get(key);
    if (!project) {
      console.warn(`  Home page: "${key}" isn't a project any more, skipping`);
      continue;
    }
    const category = projects.categories.find(c => c.id === project.category);
    (category.id === 'vertical' ? out.vertical : out.landscape).push({ project, category });
  }
  if (!out.showLandscape) out.landscape = [];
  if (!out.showSocial) out.vertical = [];

  // Each row (featured projects / featured reels) shows `count` of its projects (0 = all). With
  // shuffle on, pinned projects keep their place in the list and every other place gets a random
  // unpinned project on each visit (a small script on the home page; public/admin/js/preview.js
  // rowPlan does the same for the admin preview). The page is built with the plain top-of-the-list
  // pick, so it also works without JavaScript.
  // Soft-pinned projects take the first free places in a random order among themselves.
  const pinned = new Set(set.locked || []);
  const soft = new Set(set.soft || []);
  const plan = (items, countValue, shuffle) => {
    const count = Math.max(0, parseInt(countValue, 10) || 0);
    const n = count && count < items.length ? count : items.length;
    const keyOf = item => `${item.project.category}/${item.project.id}`;
    items.forEach((item, i) => {
      item.pinned = !!shuffle && i < n && pinned.has(keyOf(item));
      item.soft = !!shuffle && !item.pinned && soft.has(keyOf(item));
    });
    // without JavaScript: pinned stay put, soft pins fill the first free places, then the list order
    if (shuffle) {
      const fixed = new Map(items.map((item, i) => [i, item]).filter(([, item]) => item.pinned));
      const rest = [...items.filter(item => item.soft), ...items.filter(item => !item.pinned && !item.soft)];
      const ordered = [];
      for (let i = 0; i < items.length; i++) ordered.push(fixed.get(i) || rest.shift());
      items.splice(0, items.length, ...ordered.filter(Boolean));
    }
    items.forEach((item, i) => { item.shown = i < n; });
    return { count: n < items.length ? n : 0, shuffle: !!shuffle && items.length > 1, shown: n };
  };
  out.featured = plan(out.landscape, set.featuredCount, set.shuffle);
  out.reels = plan(out.vertical, set.reelsCount, set.reelsShuffle);
  out.landscapeShown = out.featured.shown;
  out.verticalShown = out.reels.shown;
  const how = [out.featured.count && `${out.featured.count} of ${out.landscape.length} landscape`, out.featured.shuffle && 'shuffled',
    out.reels.count && `${out.reels.count} of ${out.vertical.length} reels`, out.reels.shuffle && 'reels shuffled'].filter(Boolean).join(', ');
  console.log(`  Home page set: ${set.name} (${out.landscapeShown + out.verticalShown} projects shown${how ? ` (${how})` : ''})`);
  out.categoryTiles = categoryTiles(projects, set);
  return out;
}

// Build pages
async function buildPages() {
  const { projects, siteConfig } = loadData();
  for (const [name, c] of Object.entries(projects.clients || {})) {
    if (c && c.logo) CLIENT_LOGOS.set(name.trim().toLowerCase(), c.logo);
  }
  await makeWhiteLogos();

  console.log('Checking video links...');
  await resolveVideos(projects.projects);
  await fetchStats(projects.projects);

  // Common data for all templates
  const commonData = {
    site: siteConfig,
    text: readSiteText(),
    categories: projects.categories,
    currentYear: new Date().getFullYear(),
    // Fingerprints so browsers and Cloudflare fetch the new file whenever it changes
    assetVersion: {
      css: fileHash(path.join(DIST_DIR, 'css', 'styles.css')),
      js: fileHash(path.join(DIST_DIR, 'js', 'main.js'))
    }
  };

  await findBarredThumbnails(projects);
  const home = resolveHome(projects);
  LOGO_POSITION = home.logoPosition || 'corner';
  if (LOGO_POSITION !== 'corner') console.log(`  Client logos: ${LOGO_POSITION}`);

  // Build home page with Person + LocalBusiness schema
  console.log('Building home page...');
  const homeStructuredData = [
    buildPersonSchema(siteConfig),
    buildLocalBusinessSchema(siteConfig)
  ];
  const homeHtml = await renderTemplate('home', {
    clientStrip: clientLogos(projects.projects, projects.clients, readHomeFile().clientStrip),
    ...commonData,
    home,
    title: `${siteConfig.title} | Melbourne Video Editor & Colourist`,
    activePage: 'home',
    pageDescription: `${siteConfig.title} - Melbourne video editor and colourist. View my portfolio of commercial, branded, and colour grading work for clients like KIA, Deakin University, and Australian government agencies.`,
    pageUrl: '/',
    pageType: 'website',
    structuredData: homeStructuredData
  });
  await fs.outputFile(path.join(DIST_DIR, 'index.html'), homeHtml);

  // Tailored links: every home page set also gets its own address, /for/<name>/, to send with a pitch
  // (e.g. a gaming-first home page for a games studio). Not for search engines; the Traffic page shows
  // when one is opened. Visitors who arrive this way keep seeing that version when they go back Home.
  const liveLogos = LOGO_POSITION;
  for (const set of readHomeFile().sets || []) {
    const name = setLinkName(set);
    const tailored = resolveHome(projects, set.id);
    LOGO_POSITION = tailored.logoPosition || 'corner';
    const html = await renderTemplate('home', {
      clientStrip: clientLogos(projects.projects, projects.clients, readHomeFile().clientStrip),
      ...commonData,
      home: tailored,
      title: `${siteConfig.title} | Melbourne Video Editor & Colourist`,
      activePage: 'home',
      tailoredLink: `/for/${name}/`,
      noindex: true,
      pageDescription: `${siteConfig.title} - Melbourne video editor and colourist.`,
      pageUrl: '/',
      pageType: 'website',
      structuredData: homeStructuredData
    });
    await fs.outputFile(path.join(DIST_DIR, 'for', name, 'index.html'), html);
  }
  LOGO_POSITION = liveLogos;
  console.log(`  Tailored links: ${(readHomeFile().sets || []).map(s => `/for/${setLinkName(s)}/`).join(', ')}`);

  // Build about page with Person schema
  console.log('Building about page...');
  const aboutHtml = await renderTemplate('about', {
    ...commonData,
    title: `About | ${siteConfig.title}`,
    activePage: 'about',
    pageDescription: `Learn about ${siteConfig.title}, a Melbourne-based video editor with 5+ years experience. Swinburne University graduate specializing in commercial editing and colour grading.`,
    pageUrl: '/about/',
    pageType: 'profile',
    structuredData: buildPersonSchema(siteConfig)
  });
  await fs.outputFile(path.join(DIST_DIR, 'about', 'index.html'), aboutHtml);

  // Build my-work hub page
  console.log('Building my-work page...');
  const myWorkHtml = await renderTemplate('my-work', {
    ...commonData,
    title: `My Work | ${siteConfig.title}`,
    activePage: 'my-work',
    pageDescription: `Explore ${siteConfig.title}'s video editing portfolio featuring commercial campaigns, branded content, vertical social media, and professional colour grading work.`,
    pageUrl: '/my-work/',
    pageType: 'website'
  });
  await fs.outputFile(path.join(DIST_DIR, 'my-work', 'index.html'), myWorkHtml);

  // Build gallery pages and project pages for each category
  const sectionLayouts = readSectionLayouts();
  for (const category of projects.categories) {
    const categoryProjects = orderForSection(projects.projects.filter(p => p.category === category.id), sectionLayouts[category.id]);

    // Build gallery index page with ItemList schema
    console.log(`Building ${category.name} gallery...`);
    const galleryDescription = categoryDescriptions[category.id] || `${category.name} video editing and post-production work by ${siteConfig.title}, Melbourne-based video editor.`;
    const galleryHtml = await renderTemplate('gallery', {
      ...commonData,
      title: `${category.name} | ${siteConfig.title}`,
      activePage: category.slug,
      category,
      projects: categoryProjects,
      pageDescription: galleryDescription,
      pageUrl: `/${category.slug}/`,
      pageType: 'website',
      structuredData: buildItemListSchema(category, categoryProjects, siteConfig)
    });
    await fs.outputFile(path.join(DIST_DIR, category.slug, 'index.html'), galleryHtml);

    // Build individual project pages with VideoObject schema
    for (const project of categoryProjects) {
      console.log(`  Building project: ${project.title}...`);
      const projectDescription = project.description ||
        `${project.title} - ${category.name} work${project.client ? ` for ${project.client}` : ''}. Edited by ${siteConfig.title}, Melbourne video editor.`;
      const projectHtml = await renderTemplate('project', {
        ...commonData,
        title: `${project.title} | ${siteConfig.title}`,
        activePage: category.slug,
        category,
        project,
        more: moreWork(project, categoryProjects, category),
        projectLayout: home.projectLayout,
        pageDescription: projectDescription,
        pageUrl: `/${category.slug}/${project.id}/`,
        pageImage: project.thumbnail ? ogImagePath(project) : undefined,
        pageType: 'video.other',
        structuredData: buildVideoSchema(project, category, siteConfig)
      });
      await fs.outputFile(
        path.join(DIST_DIR, category.slug, project.id, 'index.html'),
        projectHtml
      );
    }
  }

  await generateOgImages(projects);
  await generateRedirects(projects, siteConfig);

  // Generate sitemap and robots.txt
  await generateSitemap(projects, siteConfig);
  await generateRobotsTxt(siteConfig);
}

// Main build function
async function build() {
  console.log('Starting build...\n');

  // Clean dist directory
  console.log('Cleaning dist directory...');
  await fs.emptyDir(DIST_DIR);

  // Build CSS
  buildCSS();

  // Copy assets
  await copyAssets();

  // Build pages
  await buildPages();

  console.log('\nBuild complete! Output in dist/');
}

// Run build
build().catch(error => {
  console.error('Build failed:', error);
  process.exit(1);
});
