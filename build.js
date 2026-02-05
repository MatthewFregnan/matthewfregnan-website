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

  // Build home page
  console.log('Building home page...');
  const homeHtml = await renderTemplate('home', {
    ...commonData,
    title: siteConfig.title,
    activePage: 'home'
  });
  await fs.outputFile(path.join(DIST_DIR, 'index.html'), homeHtml);

  // Build about page
  console.log('Building about page...');
  const aboutHtml = await renderTemplate('about', {
    ...commonData,
    title: `About | ${siteConfig.title}`,
    activePage: 'about'
  });
  await fs.outputFile(path.join(DIST_DIR, 'about', 'index.html'), aboutHtml);

  // Build my-work hub page
  console.log('Building my-work page...');
  const myWorkHtml = await renderTemplate('my-work', {
    ...commonData,
    title: `My Work | ${siteConfig.title}`,
    activePage: 'my-work'
  });
  await fs.outputFile(path.join(DIST_DIR, 'my-work', 'index.html'), myWorkHtml);

  // Build gallery pages and project pages for each category
  for (const category of projects.categories) {
    const categoryProjects = projects.projects.filter(p => p.category === category.id);

    // Build gallery index page
    console.log(`Building ${category.name} gallery...`);
    const galleryHtml = await renderTemplate('gallery', {
      ...commonData,
      title: `${category.name} | ${siteConfig.title}`,
      activePage: category.slug,
      category,
      projects: categoryProjects
    });
    await fs.outputFile(path.join(DIST_DIR, category.slug, 'index.html'), galleryHtml);

    // Build individual project pages
    for (const project of categoryProjects) {
      console.log(`  Building project: ${project.title}...`);
      const projectHtml = await renderTemplate('project', {
        ...commonData,
        title: `${project.title} | ${siteConfig.title}`,
        activePage: category.slug,
        category,
        project
      });
      await fs.outputFile(
        path.join(DIST_DIR, category.slug, project.id, 'index.html'),
        projectHtml
      );
    }
  }
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
