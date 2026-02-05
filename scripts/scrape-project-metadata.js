/**
 * Scrape project metadata (Client, Production) from all project pages
 */

const { parse } = require('node-html-parser');
const fs = require('fs-extra');
const path = require('path');

const BASE_URL = 'https://www.matthewfregnan.com';
const DATA_PATH = path.join(__dirname, '..', 'data', 'projects.json');

const DELAY_MS = 400;

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

// URL mappings for commercial pages (at root level)
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

function getProjectUrl(project) {
  if (project.category === 'commercial') {
    return commercialPageUrls[project.id] || null;
  }
  return `/${project.category}/${project.id}`;
}

async function scrapeProjectMetadata(url) {
  try {
    const html = await fetchPage(url);
    const root = parse(html);

    const metadata = {
      client: null,
      production: null,
    };

    // Look for metadata in text content
    // Common patterns: "Client | Something" or "Production | Something"
    const textContent = root.text;

    // Try to find Client
    const clientPatterns = [
      /Client\s*[|:]\s*([^\n|]+)/i,
      /Client\s*-\s*([^\n-]+)/i,
    ];
    for (const pattern of clientPatterns) {
      const match = textContent.match(pattern);
      if (match) {
        metadata.client = match[1].trim();
        break;
      }
    }

    // Try to find Production
    const productionPatterns = [
      /Production\s*[|:]\s*([^\n|]+)/i,
      /Production\s*-\s*([^\n-]+)/i,
      /Production Company\s*[|:]\s*([^\n|]+)/i,
    ];
    for (const pattern of productionPatterns) {
      const match = textContent.match(pattern);
      if (match) {
        metadata.production = match[1].trim();
        break;
      }
    }

    // Also look in structured elements
    const paragraphs = root.querySelectorAll('p, span, div');
    for (const p of paragraphs) {
      const text = p.text.trim();

      if (!metadata.client && text.toLowerCase().startsWith('client')) {
        const parts = text.split(/[|:-]/);
        if (parts.length > 1) {
          metadata.client = parts.slice(1).join(' ').trim();
        }
      }

      if (!metadata.production && text.toLowerCase().startsWith('production')) {
        const parts = text.split(/[|:-]/);
        if (parts.length > 1) {
          metadata.production = parts.slice(1).join(' ').trim();
        }
      }
    }

    return metadata;
  } catch (error) {
    console.error(`    Error: ${error.message}`);
    return { client: null, production: null };
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Scraping Project Metadata (Client, Production)');
  console.log('='.repeat(60));

  const data = await fs.readJson(DATA_PATH);

  let updated = 0;

  for (const project of data.projects) {
    const url = getProjectUrl(project);
    if (!url) {
      console.log(`Skipping: ${project.title} (no URL mapping)`);
      continue;
    }

    console.log(`\nProcessing: ${project.title}`);

    const metadata = await scrapeProjectMetadata(url);

    if (metadata.client) {
      // Don't overwrite if we already have a good client
      if (!project.client || project.client === project.title) {
        project.client = metadata.client;
        console.log(`    Client: ${metadata.client}`);
        updated++;
      }
    }

    if (metadata.production) {
      project.production = metadata.production;
      console.log(`    Production: ${metadata.production}`);
      updated++;
    }

    await delay(DELAY_MS);
  }

  // Save updated data
  await fs.writeJson(DATA_PATH, data, { spaces: 2 });

  console.log('\n' + '='.repeat(60));
  console.log(`Done! Updated ${updated} metadata fields`);
  console.log('='.repeat(60));
}

main().catch(console.error);
