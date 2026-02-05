/**
 * Clean up scraped metadata - fix concatenated values
 */

const fs = require('fs-extra');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'projects.json');

// Production company name patterns to extract
const productionPatterns = [
  'ThinkHQ',
  'Elastic',
  'Milk Video',
  'Studio Supernatural',
];

function cleanProduction(value) {
  if (!value) return null;

  // Find the production company name
  for (const company of productionPatterns) {
    if (value.includes(company)) {
      return company;
    }
  }

  // Clean common concatenations
  const cleaned = value
    .replace(/Director.*$/i, '')
    .replace(/Producer.*$/i, '')
    .replace(/DOP.*$/i, '')
    .replace(/Editor.*$/i, '')
    .replace(/Production.*$/i, '')
    .trim();

  return cleaned || null;
}

function cleanClient(value) {
  if (!value) return null;

  // Clean common concatenations
  return value
    .replace(/Production.*$/i, '')
    .replace(/Director.*$/i, '')
    .trim() || null;
}

// Known client data to fill in
const knownClients = {
  // Commercial
  'redoctane-games-studio-launch-trailer': 'Redoctane Games',
  'be-that-teacher': 'Department of Education',
  'anxiety-in-children': 'Royal Children\'s Hospital',
  'your-right-to-ask': 'Victorian Legal Services Board + Commissioner',
  'dont-miss-a-moment-film-1': 'VACCHO',
  'dont-miss-a-moment-film-2': 'VACCHO',
  'watercare': 'Yarra Valley Water',
  'women-in-construction': 'Victorian Government',
  'lonliness-spec-ad': 'Gruen (Spec Ad)',
  'racism-it-stops-with-me': 'Australian Human Rights Commission',
  'otropo-hair-salon': 'Oporto',
  'otropo-family-lunch': 'Oporto',
  'warning-levels': 'Australian Warning Systems',

  // Branded
  'mud-to-marle': 'Mud to Marle',
  'neon-streets-chau-cash-only': 'Neon Streets',
  'tab-kelly-myers-resilence': 'TAB',
  'iona-college-hero': 'Iona College',
  'deakin-alumni-25-andy': 'Deakin University',
  'deakin-alumni-25-anika': 'Deakin University',
  'deakin-cyclone': 'Deakin University',
  'deakin-genesis': 'Deakin University',
  'preshil-primary-school': 'Preshil School',
  'dss-yan-lucy-luz': 'Department of Social Services, Australian Government',
  'birth-for-humankind': 'Birth For Humankind',
  'dot-dayinthelife': 'Department of Transport Victoria',
  'dss-robert-ruby': 'Department of Social Services, Australian Government',
  'dss-mitch-indi': 'Department of Social Services, Australian Government',
  'ladbrokes-afl-8-scottcummings': 'Ladbrokes',
  'ladbrokes-afl-7-ross-glendinning': 'Ladbrokes',
  'ladbrokes-afl-5-greg-williams': 'Ladbrokes',
  'ladbrokes-afl-2-terry-williams': 'Ladbrokes',
  'dss-shaker-shameron': 'Department of Social Services, Australian Government',
  'dss-loi-son': 'Department of Social Services, Australian Government',
  'dss-katherine-andrew': 'Department of Social Services, Australian Government',
  'life-saving-vic-rockfishing': 'Life Saving Victoria',
  'project-one-f5w4d-mwg2g-ech6b-d94s3': 'STAND',
  'project-one-f5w4d-mwg2g-ech6b-d94s3-ycz6p': 'STAND',
  'project-one-f5w4d-mwg2g-ech6b-d94s3-ycz6p-9sfws': 'STAND',
  'project-one-f5w4d-mwg2g-ech6b-d94s3-ycz6p-9sfws-ewbxa': 'STAND',

  // Vertical
  'vce-games-design': 'VCAA',
  'vce-photography': 'VCAA',
  'vce-landscape-design': 'VCAA',
  'kia-ao24-influencer': 'KIA',
  'kia-shipyard': 'KIA',
  'kia-ao24-ev5': 'KIA',
  'rs-rewards-footy': 'RS Rewards',
  'rs-rewards-beer-pong': 'RS Rewards',
  'rs-rewards-bull-riding': 'RS Rewards',
  'ladbrokes-afl-scott-cummings': 'Ladbrokes',
  'ladbrokes-afl-gary-aryes': 'Ladbrokes',
  'ladbrokes-afl-leo-barry': 'Ladbrokes',
  'deakin-cyclone-cutdown-asher': 'Deakin University',
  'deakin-cyclone-cutdown': 'Deakin University',
  'deakin-genesis-nicole': 'Deakin University',

  // Colour Grading
  'riswm': 'Australian Human Rights Commission',
  'vaccho-dontmissamoment': 'VACCHO',
  'yvw-uncle-dave': 'Yarra Valley Water',
  'ptv-maskwearing': 'PTV Victoria',
  'rch-anxiety': 'Royal Children\'s Hospital',
  'yvw-watercare': 'Yarra Valley Water',
  'nonsense': 'Personal Project',
  'times-new-roman': 'Sir Jude (Music Video)',
  'mamma': 'KVNYL (Music Video)',
  'hypocrite-kvnyl': 'KVNYL (Music Video)',
  'because-youre-mine': 'SEMAJ (Music Video)',
  'wileyflow': 'Hancoq (Music Video)',
  'incandescent': 'Short Film',
  'heisi': 'Short Film',
  'wither': 'Short Film',
  'kira': 'Short Film',
  'row': 'Short Film',
  'special': 'Short Film',
};

async function main() {
  console.log('Cleaning up metadata...\n');

  const data = await fs.readJson(DATA_PATH);

  let cleaned = 0;
  let clientsAdded = 0;

  for (const project of data.projects) {
    // Clean production value
    if (project.production) {
      const cleanedProd = cleanProduction(project.production);
      if (cleanedProd !== project.production) {
        console.log(`  ${project.id}: Production "${project.production}" -> "${cleanedProd}"`);
        project.production = cleanedProd;
        cleaned++;
      }
    }

    // Clean client value
    if (project.client) {
      const cleanedClient = cleanClient(project.client);
      if (cleanedClient !== project.client) {
        console.log(`  ${project.id}: Client "${project.client}" -> "${cleanedClient}"`);
        project.client = cleanedClient;
        cleaned++;
      }
    }

    // Add known client if missing or generic
    if (knownClients[project.id]) {
      if (!project.client || project.client === project.title) {
        project.client = knownClients[project.id];
        console.log(`  ${project.id}: Added client "${knownClients[project.id]}"`);
        clientsAdded++;
      }
    }
  }

  await fs.writeJson(DATA_PATH, data, { spaces: 2 });

  console.log(`\nDone! Cleaned ${cleaned} values, added ${clientsAdded} clients`);
}

main().catch(console.error);
