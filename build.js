const fs = require('fs-extra');
const path = require('path');
const ejs = require('ejs');
const { execSync } = require('child_process');

// Paths
const DIST_DIR = path.join(__dirname, 'dist');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const DATA_DIR = path.join(__dirname, 'data');
const IMAGES_DIR = path.join(__dirname, 'images');
const SRC_DIR = path.join(__dirname, 'src');

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

  return { projects, siteConfig };
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
    "priceRange": "$$",
    "taxID": siteConfig.abn
  };
}

function buildVideoSchema(project, category, siteConfig) {
  if (!project.vimeoId && !project.youtubeId) return null;

  const videoUrl = project.vimeoId
    ? `https://vimeo.com/${project.vimeoId}`
    : `https://www.youtube.com/watch?v=${project.youtubeId}`;

  const embedUrl = project.vimeoId
    ? `https://player.vimeo.com/video/${project.vimeoId}`
    : `https://www.youtube.com/embed/${project.youtubeId}`;

  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "name": project.title,
    "description": project.description || `${category.name} project: ${project.title}${project.client ? ` for ${project.client}` : ''}`,
    "thumbnailUrl": `${siteConfig.domain}/images/thumbnails/${project.thumbnail}`,
    "contentUrl": videoUrl,
    "embedUrl": embedUrl,
    "creator": {
      "@type": "Person",
      "name": siteConfig.title
    },
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

// Category descriptions for SEO
const categoryDescriptions = {
  'commercial': 'Commercial video editing portfolio featuring campaigns for KIA, Oporto, Department of Education, and government agencies by Melbourne editor Matthew Fregnan.',
  'branded': 'Branded content video editing - corporate videos for Deakin University, TAB, DSS, and more by Melbourne-based editor Matthew Fregnan.',
  'vertical': 'Vertical video editing for social media - TikTok and Instagram content for KIA, VCAA, RS Rewards by Matthew Fregnan.',
  'colour-grading': 'Professional colour grading portfolio featuring film and commercial colour work including music videos and short films by Melbourne colourist Matthew Fregnan.'
};

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

Sitemap: ${siteConfig.domain}/sitemap.xml`;

  await fs.outputFile(path.join(DIST_DIR, 'robots.txt'), robotsTxt);
  console.log('Generated robots.txt');
}

// Render template
async function renderTemplate(templateName, data) {
  const templatePath = path.join(TEMPLATES_DIR, `${templateName}.ejs`);
  const template = await fs.readFile(templatePath, 'utf8');
  return ejs.render(template, data, { filename: templatePath });
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

// Build pages
async function buildPages() {
  const { projects, siteConfig } = loadData();

  // Common data for all templates
  const commonData = {
    site: siteConfig,
    categories: projects.categories,
    currentYear: new Date().getFullYear()
  };

  // Build home page with Person + LocalBusiness schema
  console.log('Building home page...');
  const homeStructuredData = [
    buildPersonSchema(siteConfig),
    buildLocalBusinessSchema(siteConfig)
  ];
  const homeHtml = await renderTemplate('home', {
    ...commonData,
    title: `${siteConfig.title} | Melbourne Video Editor & Colourist`,
    activePage: 'home',
    pageDescription: `${siteConfig.title} - Melbourne video editor and colourist. View my portfolio of commercial, branded, and colour grading work for clients like KIA, Deakin University, and Australian government agencies.`,
    pageUrl: '/',
    pageType: 'website',
    structuredData: homeStructuredData
  });
  await fs.outputFile(path.join(DIST_DIR, 'index.html'), homeHtml);

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
  for (const category of projects.categories) {
    const categoryProjects = projects.projects.filter(p => p.category === category.id);

    // Build gallery index page with ItemList schema
    console.log(`Building ${category.name} gallery...`);
    const galleryDescription = categoryDescriptions[category.slug] || `${category.name} video editing and post-production work by ${siteConfig.title}, Melbourne-based video editor.`;
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
        pageDescription: projectDescription,
        pageUrl: `/${category.slug}/${project.id}/`,
        pageImage: `/images/thumbnails/${project.thumbnail}`,
        pageType: 'video.other',
        structuredData: buildVideoSchema(project, category, siteConfig)
      });
      await fs.outputFile(
        path.join(DIST_DIR, category.slug, project.id, 'index.html'),
        projectHtml
      );
    }
  }

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
