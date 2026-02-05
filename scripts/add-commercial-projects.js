/**
 * Add Commercial projects to projects.json
 * These have different URL structure (at root level)
 */

const fs = require('fs-extra');
const path = require('path');
const https = require('https');

const IMAGES_DIR = path.join(__dirname, '..', 'images', 'thumbnails', 'commercial');
const DATA_PATH = path.join(__dirname, '..', 'data', 'projects.json');

// Commercial projects data from the website
const commercialProjects = [
  {
    url: '/ro-games-trailer',
    title: 'Redoctane Games Studio Launch Trailer',
    thumbnail: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/fae659eb-03de-4350-9700-17d3bd7f7595/vlcsnap-2025-10-24-21h35m04s924.png',
    client: 'Redoctane Games',
  },
  {
    url: '/doe-be-that-teacher-tvc',
    title: 'Be That Teacher',
    thumbnail: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/8116c464-04f1-4ab2-92f2-cf6021b8357d/vlcsnap-2024-06-28-14h49m42s391.png',
    client: 'Department of Education',
  },
  {
    url: '/rch-anxiety-tvc',
    title: 'Anxiety in Children',
    thumbnail: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/1667387007098-F00PWNSQ7SHMLD7FKPM8/Untitled_1.4.1.jpg',
    client: 'Royal Children\'s Hospital',
  },
  {
    url: '/vlsbc-tvc',
    title: 'Your Right To Ask',
    thumbnail: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/389a73a5-e7f7-4500-9a45-ae1b2d2e30e2/vlcsnap-2023-05-28-20h36m18s085.png',
    client: 'Victorian Legal Services Board + Commissioner',
  },
  {
    url: '/vaccho-tvc1',
    title: 'Don\'t Miss a Moment Film #1',
    thumbnail: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/1667387220139-7Z2YVLO5BOGY8LCHIEKU/Untitled_1.5.1.jpg',
    client: 'VACCHO',
  },
  {
    url: '/vaccho-tvc-2',
    title: 'Don\'t Miss a Moment Film #2',
    thumbnail: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/1667387155135-QKQBPWPW6EM3J1GXPKRC/Untitled_1.6.1.jpg',
    client: 'VACCHO',
  },
  {
    url: '/yvw-watercare-tvc',
    title: 'Watercare',
    thumbnail: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/1667387287989-ID0530RCMTSR0TCW7ADW/yvw-watercare-tvc.jpg',
    client: 'Yarra Valley Water',
  },
  {
    url: '/wic-tvc',
    title: 'Women In Construction',
    thumbnail: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/1667387413947-JI4T2DVTSYA64YNKECBO/wic-tvc.jpg',
    client: 'Women In Construction',
  },
  {
    url: '/gruen-lonliness',
    title: 'Lonliness Spec Ad',
    thumbnail: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/1667387469284-V7V22OBD7LVSF6JI27L6/Gruen.jpg',
    client: 'Gruen',
  },
  {
    url: '/riswm',
    title: 'Racism. It Stops With Me.',
    thumbnail: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/6ab4783c-4a6e-4e5e-b704-84851075175a/RISWM.jpg',
    client: 'Australian Human Rights Commission',
  },
  {
    url: '/oporto-hair-salon',
    title: 'Otropo "Hair Salon"',
    thumbnail: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/7c86e90e-0857-4bfd-be2a-bbffe74a2a34/Oporto+Otropo+-+Hair+Salon+15%22+TVC-0001.png',
    client: 'Oporto',
  },
  {
    url: '/oporto-family-lunch-tvc',
    title: 'Otropo "Family Lunch"',
    thumbnail: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/202d9e09-4320-405d-a6a0-eea95b68eb8f/Oporto+Otropo+-+Family+Lunch+15%22+TVC-0002.png',
    client: 'Oporto',
  },
  {
    url: '/aws-warning-signs-tvc',
    title: 'Warning Levels',
    thumbnail: 'https://images.squarespace-cdn.com/content/v1/5e56fcdb12b1513ca741c609/32493793-befc-4e0f-9c40-77e579e14f46/vlcsnap-2024-06-28-14h46m31s339.png',
    client: 'Australian Warning Systems',
  },
];

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
    if (fs.existsSync(filepath)) {
      console.log(`  Skipping (exists): ${path.basename(filepath)}`);
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
        console.log(`  Downloaded: ${path.basename(filepath)}`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(filepath, () => {});
      reject(err);
    });
  });
}

async function main() {
  console.log('Adding Commercial projects...\n');

  // Load existing data
  const data = await fs.readJson(DATA_PATH);

  const newProjects = [];

  for (const project of commercialProjects) {
    const slug = slugify(project.title);
    const ext = path.extname(project.thumbnail.split('?')[0]) || '.jpg';
    const thumbnailFilename = `${slug}${ext}`;
    const thumbnailPath = path.join(IMAGES_DIR, thumbnailFilename);

    console.log(`Processing: ${project.title}`);

    // Download thumbnail
    try {
      await downloadImage(project.thumbnail, thumbnailPath);
    } catch (error) {
      console.error(`  Failed to download: ${error.message}`);
    }

    // Create project entry
    newProjects.push({
      id: slug,
      title: project.title,
      category: 'commercial',
      vimeoId: '', // Will need to be filled in manually or via another scrape
      thumbnail: `commercial/${thumbnailFilename}`,
      client: project.client,
      description: '',
      role: 'Editor',
      year: '',
    });
  }

  // Add commercial projects to the beginning of the array
  data.projects = [...newProjects, ...data.projects];

  // Save updated data
  await fs.writeJson(DATA_PATH, data, { spaces: 2 });

  console.log(`\nAdded ${newProjects.length} commercial projects`);
  console.log(`Total projects: ${data.projects.length}`);
}

main().catch(console.error);
