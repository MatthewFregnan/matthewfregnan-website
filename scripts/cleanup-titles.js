/**
 * Clean up project titles in projects.json
 * Converts URL slugs to proper titles
 */

const fs = require('fs-extra');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'projects.json');

// Title mappings for known projects
const titleMappings = {
  // Branded
  'mud-to-marle': 'Mud to Marle',
  'neon-streets-chau-cash-only': 'Neon Streets - Chau & Cash Only',
  'tab-kelly-myers-resilence': 'TAB - Kelly Myers Resilience',
  'iona-college-hero': 'Iona College - Welcome Video',
  'deakin-alumni-25-andy': 'Deakin Alumni \'25 - Andy',
  'deakin-alumni-25-anika': 'Deakin Alumni \'25 - Anika',
  'deakin-cyclone': 'Deakin - Cyclone',
  'deakin-genesis': 'Deakin - Genesis',
  'preshil-primary-school': 'Preshil Primary School',
  'dss-yan-lucy-luz': 'DSS - Yan, Lucy & Luz',
  'birth-for-humankind': 'Birth For Humankind',
  'dot-dayinthelife': 'DOT - A Day In The Life',
  'dss-robert-ruby': 'DSS - Robert & Ruby',
  'dss-mitch-indi': 'DSS - Mitch & Indi',
  'ladbrokes-afl-8-scottcummings': 'Ladbrokes AFL - Scott Cummings',
  'ladbrokes-afl-7-ross-glendinning': 'Ladbrokes AFL - Ross Glendinning',
  'ladbrokes-afl-5-greg-williams': 'Ladbrokes AFL - Greg Williams',
  'ladbrokes-afl-2-terry-williams': 'Ladbrokes AFL - Terry Williams',
  'dss-shaker-shameron': 'DSS - Shaker & Shameron',
  'dss-loi-son': 'DSS - Loi & Son',
  'dss-katherine-andrew': 'DSS - Katherine & Andrew',
  'life-saving-vic-rockfishing': 'Life Saving Vic - Rock Fishing',
  'project-one-f5w4d-mwg2g-ech6b-d94s3': 'STAND - Featured Profile #1',
  'project-one-f5w4d-mwg2g-ech6b-d94s3-ycz6p': 'STAND - Featured Profile #2',
  'project-one-f5w4d-mwg2g-ech6b-d94s3-ycz6p-9sfws': 'STAND - Featured Profile #3',
  'project-one-f5w4d-mwg2g-ech6b-d94s3-ycz6p-9sfws-ewbxa': 'STAND - Featured Profile #4',

  // Vertical
  'vce-games-design': 'VCE - Games Design (Millie Ford)',
  'vce-photography': 'VCE - Photography (Millie Ford)',
  'vce-landscape-design': 'VCE - Landscape Design (Millie Ford)',
  'kia-ao24-influencer': 'KIA AO24 - Influencer Story',
  'kia-shipyard': 'KIA EV9 - Shipyard',
  'kia-ao24-ev5': 'KIA AO24 - EV5',
  'rs-rewards-footy': 'RS Rewards - Friday Night Footy',
  'rs-rewards-beer-pong': 'RS Rewards - Beer Pong',
  'rs-rewards-bull-riding': 'RS Rewards - Bull Riding',
  'ladbrokes-afl-scott-cummings': 'Ladbrokes AFL - Scott Cummings',
  'ladbrokes-afl-gary-aryes': 'Ladbrokes AFL - Gary Ayres',
  'ladbrokes-afl-leo-barry': 'Ladbrokes AFL - Leo Barry',
  'deakin-cyclone-cutdown-asher': 'Deakin Cyclone - Asher',
  'deakin-cyclone-cutdown': 'Deakin Cyclone - Cutdown',
  'deakin-genesis-nicole': 'Deakin Genesis - Nicole',

  // Colour Grading
  'riswm': 'Racism. It Stops With Me.',
  'vaccho-dontmissamoment': 'VACCHO - Don\'t Miss a Moment',
  'yvw-uncle-dave': 'Yarra Valley Water - Uncle Dave',
  'ptv-maskwearing': 'PTV - Mask Wearing',
  'rch-anxiety': 'Royal Children\'s Hospital - Anxiety',
  'yvw-watercare': 'Yarra Valley Water - Watercare',
  'nonsense': 'Nonsense',
  'times-new-roman': 'Times New Roman - Sir Jude',
  'mamma': 'Mamma - KVNYL',
  'hypocrite-kvnyl': 'Hypocrite - KVNYL',
  'because-youre-mine': 'Because You\'re Mine - SEMAJ',
  'wileyflow': 'Wiley Flow - Hancoq',
  'incandescent': 'Incandescent',
  'heisi': 'Heisi',
  'wither': 'Wither',
  'kira': 'Kira',
  'row': 'Row',
  'special': 'Special',
};

// Client mappings
const clientMappings = {
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
  'dss-yan-lucy-luz': 'DSS',
  'birth-for-humankind': 'Birth For Humankind',
  'dot-dayinthelife': 'Department of Transport',
  'dss-robert-ruby': 'DSS',
  'dss-mitch-indi': 'DSS',
  'ladbrokes-afl-8-scottcummings': 'Ladbrokes',
  'ladbrokes-afl-7-ross-glendinning': 'Ladbrokes',
  'ladbrokes-afl-5-greg-williams': 'Ladbrokes',
  'ladbrokes-afl-2-terry-williams': 'Ladbrokes',
  'dss-shaker-shameron': 'DSS',
  'dss-loi-son': 'DSS',
  'dss-katherine-andrew': 'DSS',
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
  'dot-dayinthelife': 'Department of Transport',
  'yvw-uncle-dave': 'Yarra Valley Water',
  'ptv-maskwearing': 'PTV',
  'rch-anxiety': 'Royal Children\'s Hospital',
  'yvw-watercare': 'Yarra Valley Water',
};

async function main() {
  console.log('Cleaning up project titles...\n');

  const data = await fs.readJson(DATA_PATH);
  let updated = 0;

  for (const project of data.projects) {
    // Update title if mapping exists
    if (titleMappings[project.id]) {
      console.log(`  ${project.id} -> "${titleMappings[project.id]}"`);
      project.title = titleMappings[project.id];
      updated++;
    }

    // Update client if mapping exists and client is empty
    if (clientMappings[project.id] && !project.client) {
      project.client = clientMappings[project.id];
    }
  }

  await fs.writeJson(DATA_PATH, data, { spaces: 2 });

  console.log(`\nUpdated ${updated} project titles`);
}

main().catch(console.error);
