/**
 * Download missing thumbnails
 */

const fs = require('fs-extra');
const path = require('path');
const https = require('https');

const DATA_PATH = path.join(__dirname, '..', 'data', 'projects.json');
const THUMBNAILS_DIR = path.join(__dirname, '..', 'images', 'thumbnails');

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

// Missing thumbnails with their URLs
const missingThumbnails = [
  {
    id: 'mud-to-marle',
    category: 'branded',
    url: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/48b31792-ee86-47c6-8308-bb922d996b8a/Sequence+05.00_00_17_05.Still001.png',
  },
  {
    id: 'ladbrokes-afl-7-ross-glendinning',
    category: 'branded',
    url: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/1719553394533-2LO3OJE3VKC886T1PMG9/E002199_AFL_AAFOC_EP7_ROSS_GLENDINNING_THUMBNAIL_16x9.png',
  },
  {
    id: 'ladbrokes-afl-5-greg-williams',
    category: 'branded',
    url: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/1719553468476-P3XL5DP44K8YPV9YV3U6/maxresdefault-2.jpg',
  },
  {
    id: 'ladbrokes-afl-2-terry-williams',
    category: 'branded',
    url: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/1719553523146-50QEO47PPLZPYS83YLRP/maxresdefault-3.jpg',
  },
  {
    id: 'rs-rewards-beer-pong',
    category: 'vertical',
    url: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/ca1a2fc5-1768-4bb5-9ff0-fc763634622a/vlcsnap-2025-06-29-12h16m12s946.png',
  },
  {
    id: 'rs-rewards-bull-riding',
    category: 'vertical',
    url: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/4bbaa212-5001-444b-a7eb-3523a3ba55ea/vlcsnap-2025-06-29-12h24m27s999.png',
  },
];

async function main() {
  console.log('Downloading missing thumbnails...\n');

  const data = await fs.readJson(DATA_PATH);

  for (const item of missingThumbnails) {
    console.log(`Processing: ${item.id}`);

    const project = data.projects.find(p => p.id === item.id);
    if (!project) {
      console.log(`  Project not found in data!`);
      continue;
    }

    const thumbnailDir = path.join(THUMBNAILS_DIR, item.category);
    await fs.ensureDir(thumbnailDir);

    // Get extension from URL
    const ext = item.url.includes('.png') ? 'png' : 'jpg';
    const filename = `${item.id}.${ext}`;
    const filepath = path.join(thumbnailDir, filename);

    try {
      await downloadImage(item.url, filepath);
      project.thumbnail = `${item.category}/${filename}`;
      console.log(`  Downloaded: ${filename}`);
    } catch (err) {
      console.log(`  Failed: ${err.message}`);
    }
  }

  // Save updated data
  await fs.writeJson(DATA_PATH, data, { spaces: 2 });

  console.log('\nDone!');
}

main().catch(console.error);
