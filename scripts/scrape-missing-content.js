/**
 * Scrape missing content:
 * - Vimeo IDs from commercial pages
 * - Gallery images from colour grading pages
 */

const { parse } = require('node-html-parser');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');

const BASE_URL = 'https://www.matthewfregnan.com';
const DATA_PATH = path.join(__dirname, '..', 'data', 'projects.json');
const GALLERY_DIR = path.join(__dirname, '..', 'images', 'gallery');

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

async function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(filepath)) {
      console.log(`    Skipping (exists): ${path.basename(filepath)}`);
      return resolve();
    }

    fs.ensureDirSync(path.dirname(filepath));
    const file = fs.createWriteStream(filepath);

    https.get(url, (response) => {
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

// Commercial page URL mappings (root-level URLs)
const commercialPageUrls = {
  'redoctane-games-studio-launch-trailer': '/ro-games-trailer',
  'be-that-teacher': '/doe-be-that-teacher-tvc',
  'anxiety-in-children': '/rch-anxiety-tvc',
  'your-right-to-ask': '/vlsbc-tvc',
  'dont-miss-a-moment-film-1': '/vaccho-tvc1',
  'dont-miss-a-moment-film-2': '/vaccho-tvc-2',
  'watercare': '/yvw-watercare-tvc',
  'women-in-construction': '/wic-tvc',
  'lonliness-spec-ad': '/gruen-lonliness',
  'racism-it-stops-with-me': '/riswm',
  'otropo-hair-salon': '/oporto-hair-salon',
  'otropo-family-lunch': '/oporto-family-lunch-tvc',
  'warning-levels': '/aws-warning-signs-tvc',
};

async function scrapeVimeoId(url) {
  try {
    const html = await fetchPage(url);
    const root = parse(html);

    // Look for Vimeo in various places
    const patterns = [
      /player\.vimeo\.com\/video\/(\d+)/,
      /vimeo\.com\/video\/(\d+)/,
      /vimeo\.com\/(\d+)/,
      /"videoId":"(\d+)"/,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        return match[1];
      }
    }

    // Check iframes
    const iframes = root.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = iframe.getAttribute('src') || iframe.getAttribute('data-src') || '';
      for (const pattern of patterns) {
        const match = src.match(pattern);
        if (match) {
          return match[1];
        }
      }
    }

    // Check data attributes and embedded JSON
    const scripts = root.querySelectorAll('script');
    for (const script of scripts) {
      const content = script.text || '';
      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
          return match[1];
        }
      }
    }

    return null;
  } catch (error) {
    console.error(`    Error: ${error.message}`);
    return null;
  }
}

async function scrapeGalleryImages(projectId, url) {
  try {
    const html = await fetchPage(url);
    const root = parse(html);

    const images = [];
    const seenUrls = new Set();

    // Find all images in the page (carousel/gallery images)
    const imgElements = root.querySelectorAll('img[src*="squarespace-cdn"]');

    for (const img of imgElements) {
      let src = img.getAttribute('src') || img.getAttribute('data-src') || '';

      if (!src || seenUrls.has(src)) continue;

      // Skip small thumbnails and navigation images
      if (src.includes('100w') || src.includes('format=100w')) continue;

      // Clean URL
      src = src.split('?')[0];
      if (!src.startsWith('http')) {
        src = 'https:' + src;
      }

      seenUrls.add(src);

      // Get file extension
      const ext = path.extname(src) || '.jpg';
      const filename = `${projectId}-${images.length + 1}${ext}`;

      images.push({
        url: src,
        filename: filename,
      });
    }

    return images;
  } catch (error) {
    console.error(`    Error: ${error.message}`);
    return [];
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Scraping Missing Content');
  console.log('='.repeat(60));

  const data = await fs.readJson(DATA_PATH);

  // Track updates
  let vimeoUpdates = 0;
  let galleryUpdates = 0;

  // Scrape Vimeo IDs for commercial projects
  console.log('\n--- Commercial Vimeo IDs ---\n');

  for (const project of data.projects) {
    if (project.category === 'commercial' && !project.vimeoId) {
      const pageUrl = commercialPageUrls[project.id];
      if (pageUrl) {
        console.log(`Processing: ${project.title}`);
        const vimeoId = await scrapeVimeoId(pageUrl);
        if (vimeoId) {
          project.vimeoId = vimeoId;
          console.log(`    Found Vimeo ID: ${vimeoId}`);
          vimeoUpdates++;
        } else {
          console.log(`    No Vimeo ID found`);
        }
        await delay(DELAY_MS);
      }
    }
  }

  // Scrape gallery images for colour grading projects
  console.log('\n--- Colour Grading Galleries ---\n');

  for (const project of data.projects) {
    if (project.category === 'colour-grading') {
      const pageUrl = `/colour-grading/${project.id}`;
      console.log(`Processing: ${project.title}`);

      const images = await scrapeGalleryImages(project.id, pageUrl);

      if (images.length > 0) {
        console.log(`    Found ${images.length} gallery images`);

        // Download images
        const galleryFilenames = [];
        for (const image of images) {
          const filepath = path.join(GALLERY_DIR, project.id, image.filename);
          try {
            await downloadImage(image.url, filepath);
            galleryFilenames.push(`${project.id}/${image.filename}`);
          } catch (err) {
            console.error(`    Failed to download: ${err.message}`);
          }
        }

        if (galleryFilenames.length > 0) {
          project.gallery = galleryFilenames;
          galleryUpdates++;
        }
      } else {
        console.log(`    No gallery images found`);
      }

      await delay(DELAY_MS);
    }
  }

  // Save updated data
  await fs.writeJson(DATA_PATH, data, { spaces: 2 });

  console.log('\n' + '='.repeat(60));
  console.log(`Done!`);
  console.log(`  Vimeo IDs updated: ${vimeoUpdates}`);
  console.log(`  Galleries updated: ${galleryUpdates}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
