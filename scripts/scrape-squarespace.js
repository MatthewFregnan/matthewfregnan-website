/**
 * Squarespace Asset Scraper
 *
 * This script extracts:
 * - Project thumbnails from gallery pages
 * - Vimeo video IDs from individual project pages
 * - Project metadata (title, client)
 *
 * Usage: node scripts/scrape-squarespace.js
 */

const { parse } = require('node-html-parser');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const http = require('http');

const BASE_URL = 'https://www.matthewfregnan.com';

const CATEGORIES = [
  { id: 'commercial', name: 'Commercial', slug: 'commercial', url: '/commercial' },
  { id: 'branded', name: 'Branded', slug: 'branded', url: '/branded' },
  { id: 'vertical', name: 'Vertical', slug: 'vertical', url: '/vertical' },
  { id: 'colour-grading', name: 'Colour Grading', slug: 'colour-grading', url: '/colour-grading' },
];

const OUTPUT_DIR = path.join(__dirname, '..', 'data');
const IMAGES_DIR = path.join(__dirname, '..', 'images', 'thumbnails');

// Delay between requests to be polite to the server
const DELAY_MS = 500;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPage(url) {
  const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
  console.log(`  Fetching: ${fullUrl}`);

  const response = await fetch(fullUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; asset-extractor/1.0)',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${fullUrl}`);
  }

  return response.text();
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

async function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    // Skip if already exists
    if (fs.existsSync(filepath)) {
      console.log(`    Skipping (exists): ${path.basename(filepath)}`);
      return resolve();
    }

    fs.ensureDirSync(path.dirname(filepath));

    const file = fs.createWriteStream(filepath);

    protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadImage(response.headers.location, filepath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`    Downloaded: ${path.basename(filepath)}`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(filepath, () => {});
      reject(err);
    });
  });
}

async function scrapeGalleryPage(category) {
  console.log(`\nScraping ${category.name} gallery...`);

  const html = await fetchPage(category.url);
  const root = parse(html);

  const projects = [];

  // Find all portfolio items - Squarespace uses various selectors
  const items = root.querySelectorAll('.portfolio-grid-basic a, .portfolio-hover a, [data-animation-role="image"] a, .gallery-grid a, .summary-item a, .portfolio-item a');

  // Also try to find items in the main content area
  const allLinks = root.querySelectorAll('a[href^="/"]');

  const projectLinks = new Set();

  allLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href && href.startsWith(category.url + '/') && !href.includes('#')) {
      projectLinks.add(href);
    }
  });

  // Also look for image links
  const imageLinks = root.querySelectorAll('a');
  imageLinks.forEach(link => {
    const href = link.getAttribute('href');
    const img = link.querySelector('img');

    if (href && img) {
      const src = img.getAttribute('src') || img.getAttribute('data-src');
      const alt = img.getAttribute('alt') || '';

      if (href.startsWith(category.url + '/')) {
        projectLinks.add(href);
      }
    }
  });

  console.log(`  Found ${projectLinks.size} project links`);

  // Process each project
  for (const projectUrl of projectLinks) {
    await delay(DELAY_MS);

    try {
      const project = await scrapeProjectPage(projectUrl, category);
      if (project) {
        projects.push(project);
      }
    } catch (error) {
      console.error(`  Error scraping ${projectUrl}:`, error.message);
    }
  }

  return projects;
}

async function scrapeProjectPage(url, category) {
  const html = await fetchPage(url);
  const root = parse(html);

  // Extract title
  const titleEl = root.querySelector('h1, .page-title, .entry-title, [data-content-field="title"]');
  const title = titleEl ? titleEl.text.trim() : path.basename(url);

  console.log(`  Processing: ${title}`);

  // Extract Vimeo ID from iframe
  let vimeoId = '';
  const iframe = root.querySelector('iframe[src*="vimeo"], iframe[data-src*="vimeo"]');
  if (iframe) {
    const src = iframe.getAttribute('src') || iframe.getAttribute('data-src') || '';
    const match = src.match(/vimeo\.com\/video\/(\d+)/);
    if (match) {
      vimeoId = match[1];
      console.log(`    Vimeo ID: ${vimeoId}`);
    }
  }

  // Also check for Vimeo in embed blocks
  if (!vimeoId) {
    const embedCode = root.querySelector('.sqs-video-wrapper, .video-block, [data-block-type="5"]');
    if (embedCode) {
      const htmlContent = embedCode.toString();
      const match = htmlContent.match(/vimeo\.com\/video\/(\d+)/);
      if (match) {
        vimeoId = match[1];
        console.log(`    Vimeo ID (from embed): ${vimeoId}`);
      }
    }
  }

  // Extract thumbnail - look for the main image
  let thumbnailUrl = '';
  const mainImage = root.querySelector('.content-wrapper img, .main-image img, article img, .project-image img, [data-image-id] img');
  if (mainImage) {
    thumbnailUrl = mainImage.getAttribute('src') || mainImage.getAttribute('data-src') || '';
  }

  // If no main image, look for any prominent image
  if (!thumbnailUrl) {
    const anyImage = root.querySelector('img[src*="squarespace-cdn"]');
    if (anyImage) {
      thumbnailUrl = anyImage.getAttribute('src') || '';
    }
  }

  // Clean up thumbnail URL (get highest quality)
  if (thumbnailUrl) {
    // Remove any size parameters and get original
    thumbnailUrl = thumbnailUrl.split('?')[0];
    if (!thumbnailUrl.startsWith('http')) {
      thumbnailUrl = 'https:' + thumbnailUrl;
    }
    console.log(`    Thumbnail: ${thumbnailUrl.substring(0, 80)}...`);
  }

  // Generate slug
  const slug = slugify(title) || path.basename(url);

  // Download thumbnail
  if (thumbnailUrl) {
    const ext = path.extname(thumbnailUrl.split('?')[0]) || '.jpg';
    const imagePath = path.join(IMAGES_DIR, category.slug, `${slug}${ext}`);

    try {
      await downloadImage(thumbnailUrl, imagePath);
    } catch (error) {
      console.error(`    Failed to download thumbnail:`, error.message);
    }
  }

  return {
    id: slug,
    title: title,
    category: category.id,
    vimeoId: vimeoId,
    thumbnail: thumbnailUrl ? `${category.slug}/${slug}${path.extname(thumbnailUrl.split('?')[0]) || '.jpg'}` : '',
    client: '',
    description: '',
    role: 'Editor',
    year: '',
  };
}

async function scrapeHeadshot() {
  console.log('\nScraping About page for headshot...');

  try {
    const html = await fetchPage('/about');
    const root = parse(html);

    // Look for profile image
    const img = root.querySelector('.image-block img, .sqs-block-image img, article img');
    if (img) {
      let src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (src) {
        src = src.split('?')[0];
        if (!src.startsWith('http')) {
          src = 'https:' + src;
        }

        const headshotPath = path.join(__dirname, '..', 'images', 'headshot.jpg');
        await downloadImage(src, headshotPath);
        console.log('  Headshot downloaded');
      }
    }
  } catch (error) {
    console.error('  Failed to scrape headshot:', error.message);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Squarespace Asset Scraper');
  console.log('='.repeat(60));

  const allProjects = [];

  // Scrape each category
  for (const category of CATEGORIES) {
    const projects = await scrapeGalleryPage(category);
    allProjects.push(...projects);
    await delay(DELAY_MS);
  }

  // Scrape headshot
  await scrapeHeadshot();

  // Generate projects.json
  const data = {
    categories: CATEGORIES.map(c => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
    })),
    projects: allProjects,
  };

  const outputPath = path.join(OUTPUT_DIR, 'projects.json');
  await fs.writeJson(outputPath, data, { spaces: 2 });

  console.log('\n' + '='.repeat(60));
  console.log(`Done! Scraped ${allProjects.length} projects`);
  console.log(`Projects saved to: ${outputPath}`);
  console.log('='.repeat(60));

  // Summary by category
  console.log('\nSummary:');
  for (const category of CATEGORIES) {
    const count = allProjects.filter(p => p.category === category.id).length;
    console.log(`  ${category.name}: ${count} projects`);
  }

  // List projects missing Vimeo IDs
  const missingVimeo = allProjects.filter(p => !p.vimeoId);
  if (missingVimeo.length > 0) {
    console.log(`\nProjects missing Vimeo IDs (${missingVimeo.length}):`);
    missingVimeo.forEach(p => console.log(`  - ${p.title}`));
  }
}

main().catch(console.error);
