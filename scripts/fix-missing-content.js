/**
 * Fix missing thumbnails and Vimeo IDs for specific projects
 */

const { parse } = require('node-html-parser');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');

const BASE_URL = 'https://www.matthewfregnan.com';
const DATA_PATH = path.join(__dirname, '..', 'data', 'projects.json');
const THUMBNAILS_DIR = path.join(__dirname, '..', 'images', 'thumbnails');

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

function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(filepath);
        downloadImage(response.headers.location, filepath).then(resolve).catch(reject);
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(filepath, () => {});
      reject(err);
    });
  });
}

// Projects that need fixing with their URLs
const projectsToFix = [
  { id: 'rs-rewards-beer-pong', category: 'vertical', url: '/vertical/rs-rewards-beer-pong' },
  { id: 'rs-rewards-bull-riding', category: 'vertical', url: '/vertical/rs-rewards-bull-riding' },
  { id: 'mud-to-marle', category: 'branded', url: '/branded/mud-to-marle' },
  { id: 'ladbrokes-afl-7-ross-glendinning', category: 'branded', url: '/branded/ladbrokes-afl-7-ross-glendinning' },
  { id: 'ladbrokes-afl-5-greg-williams', category: 'branded', url: '/branded/ladbrokes-afl-5-greg-williams' },
  { id: 'ladbrokes-afl-2-terry-williams', category: 'branded', url: '/branded/ladbrokes-afl-2-terry-williams' },
];

async function scrapeProject(projectInfo) {
  try {
    const html = await fetchPage(projectInfo.url);
    const root = parse(html);

    const result = {
      vimeoId: null,
      thumbnailUrl: null,
    };

    // Find Vimeo ID
    const iframes = root.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = iframe.getAttribute('src') || '';
      const vimeoMatch = src.match(/player\.vimeo\.com\/video\/(\d+)/);
      if (vimeoMatch) {
        result.vimeoId = vimeoMatch[1];
        break;
      }
    }

    // Find thumbnail image
    const images = root.querySelectorAll('img');
    for (const img of images) {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (src && src.includes('squarespace-cdn.com') && !src.includes('logo')) {
        result.thumbnailUrl = src.split('?')[0]; // Remove query params
        break;
      }
    }

    // Also check for background images in style attributes
    if (!result.thumbnailUrl) {
      const divsWithBg = root.querySelectorAll('[style*="background"]');
      for (const div of divsWithBg) {
        const style = div.getAttribute('style') || '';
        const urlMatch = style.match(/url\(['"]?(https:\/\/[^'")\s]+)['"]?\)/);
        if (urlMatch && urlMatch[1].includes('squarespace-cdn.com')) {
          result.thumbnailUrl = urlMatch[1].split('?')[0];
          break;
        }
      }
    }

    return result;
  } catch (error) {
    console.error(`    Error: ${error.message}`);
    return { vimeoId: null, thumbnailUrl: null };
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Fixing Missing Thumbnails and Vimeo IDs');
  console.log('='.repeat(60));

  const data = await fs.readJson(DATA_PATH);

  for (const projectInfo of projectsToFix) {
    console.log(`\nProcessing: ${projectInfo.id}`);

    const scraped = await scrapeProject(projectInfo);
    console.log(`  Found Vimeo ID: ${scraped.vimeoId || 'none'}`);
    console.log(`  Found Thumbnail: ${scraped.thumbnailUrl ? 'yes' : 'none'}`);

    // Find project in data
    const project = data.projects.find(p => p.id === projectInfo.id);
    if (!project) {
      console.log(`  Project not found in data!`);
      continue;
    }

    // Update Vimeo ID if missing
    if (scraped.vimeoId && !project.vimeoId) {
      project.vimeoId = scraped.vimeoId;
      console.log(`  Updated Vimeo ID: ${scraped.vimeoId}`);
    }

    // Download thumbnail if missing
    if (scraped.thumbnailUrl && !project.thumbnail) {
      const thumbnailDir = path.join(THUMBNAILS_DIR, projectInfo.category);
      await fs.ensureDir(thumbnailDir);

      const filename = `${projectInfo.id}.jpg`;
      const filepath = path.join(thumbnailDir, filename);

      try {
        await downloadImage(scraped.thumbnailUrl, filepath);
        project.thumbnail = `${projectInfo.category}/${filename}`;
        console.log(`  Downloaded thumbnail: ${filename}`);
      } catch (err) {
        console.log(`  Failed to download thumbnail: ${err.message}`);
      }
    }

    await delay(DELAY_MS);
  }

  // Save updated data
  await fs.writeJson(DATA_PATH, data, { spaces: 2 });

  console.log('\n' + '='.repeat(60));
  console.log('Done!');
  console.log('='.repeat(60));
}

main().catch(console.error);
