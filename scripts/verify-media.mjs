import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { load } from 'cheerio';
import { chromium, devices, webkit } from 'playwright';

const base = process.env.GMC_PREVIEW_URL || 'http://127.0.0.1:4177';
const dist = new URL('../dist/', import.meta.url);
const auditDir = new URL('../artifacts/', import.meta.url);
const offline = JSON.parse(await readFile(new URL('copy-audit.json', auditDir), 'utf8'));
const missing = new Set(offline.absentAssets.map(asset => new URL(asset.url).pathname));
const photos = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i;
const pages = (await readdir(dist, { recursive: true })).filter(path => /(^|\/)index\.html$/.test(path));
const templates = new Map();
const inventory = { pages: pages.length, inlinePhotos: 0, originalPhotoSubstitutions: 0, layouts: {} };
for (const page of pages) {
  const $ = load(await readFile(new URL(page.split('/').map(encodeURIComponent).join('/'), dist), 'utf8'));
  const main = $('main.site-main, .elementor-location-single, .elementor-location-archive, main').first();
  const type = main.attr('class')?.match(/elementor-location-\w+|site-main/)?.[0] || 'other';
  const layout = type + ' ' + (main.find('.e-parent').first().attr('data-id') || '');
  const route = '/' + page.replace(/index\.html$/, '');
  const candidates = main.find('img').toArray().filter(img => ['src', 'data-lazy-src', 'data-src'].some(name => photos.test($(img).attr(name) || '')));
  inventory.inlinePhotos += candidates.length;
  inventory.originalPhotoSubstitutions += main.find('img[data-gmc-original-photo]').length;
  inventory.layouts[layout] = (inventory.layouts[layout] || 0) + 1;
  if (!templates.has(layout)) templates.set(layout, route);
}

const samples = [...new Set([
  ...templates.values(),
  '/plastic-surgery/gmc-services-will-transform-your-trip/',
  '/plastic-surgery/nose-job-korea/',
  '/zh/', '/id/', '/th/', '/ru/', '/tw/',
  '/tw/plastic-surgery/gmc-services-will-transform-your-trip/',
])];
const failures = [];
const observations = [];
const chrome = await chromium.launch();
const safari = await webkit.launch();

function verifyVisiblePhotos() {
  const content = document.querySelector('main.site-main, .elementor-location-single, .elementor-location-archive, main');
  if (!content) return { photos: 0, backgrounds: 0, failures: ['No page content'] };
  const issues = [];
  const visible = node => Boolean(node.getClientRects().length && !node.closest('[hidden]'));
  const raster = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|["')]|$)/i;
  let photoCount = 0;
  let backgroundCount = 0;
  for (const image of content.querySelectorAll('img')) {
    const source = image.dataset.lazySrc || image.dataset.src || image.currentSrc || image.src;
    if (!visible(image) || !raster.test(source)) continue;
    photoCount++;
    const style = getComputedStyle(image);
    if (style.objectFit !== 'contain' || style.borderRadius !== '0px') {
      issues.push(`Inline photo ${image.className}: ${style.objectFit}, radius ${style.borderRadius}`);
    }
    const thumbnail = image.closest('.elementor-post__thumbnail');
    if (thumbnail) {
      const bounds = image.getBoundingClientRect();
      const frame = thumbnail.getBoundingClientRect();
      if (['top', 'right', 'bottom', 'left'].some(edge => Math.abs(bounds[edge] - frame[edge]) > 1)) {
        issues.push(`Photo is offset from its archive frame: ${source}`);
      }
    }
  }
  for (const frame of content.querySelectorAll('.elementor-element, .elementor-bg, .elementor-carousel-image, [style*="background-image"]')) {
    if (!visible(frame)) continue;
    for (const pseudo of [null, '::before']) {
      const style = getComputedStyle(frame, pseudo);
      if (!raster.test(style.backgroundImage)) continue;
      backgroundCount++;
      if (style.backgroundSize !== 'contain') {
        issues.push(`Background ${frame.dataset.id || frame.className} ${pseudo || ''}: ${style.backgroundSize}`);
      }
    }
  }
  return { photos: photoCount, backgrounds: backgroundCount, failures: issues };
}

async function check(browser, options, label, paths) {
  const page = await browser.newPage({ ...options, reducedMotion: 'reduce' });
  try {
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === base && route.request().method() === 'GET' && !missing.has(url.pathname)
        ? route.continue()
        : route.abort();
    });
    for (const path of paths) {
      try {
        const response = await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 15000 });
        assert.equal(response.status(), 200);
        await page.locator('.gmc-header').waitFor({ timeout: 5000 });
        const result = await page.evaluate(verifyVisiblePhotos);
        observations.push({ path, viewport: label, photos: result.photos, backgrounds: result.backgrounds });
        if (result.failures.length) failures.push({ path, viewport: label, issues: [...new Set(result.failures)].slice(0, 12) });
      } catch (error) {
        failures.push({ path, viewport: label, issues: [error.message.split('\n')[0]] });
      }
    }
  } finally {
    await page.close();
  }
}

try {
  await Promise.all(Array.from({ length: 3 }, (_, index) => {
    const batch = samples.filter((_, i) => i % 3 === index);
    return Promise.all([
      check(chrome, { viewport: { width: 1440, height: 900 } }, 'Chromium desktop', batch),
      check(safari, { ...devices['iPhone 15'] }, 'WebKit phone', batch),
    ]);
  }));
} finally {
  await Promise.all([chrome.close(), safari.close()]);
}
await writeFile(new URL('photo-framing-audit.json', auditDir), JSON.stringify({ inventory, observations, failures }, null, 2) + '\n');
console.log(`${pages.length} local pages inventoried, ${observations.length} desktop and phone page renders, ${failures.length} with framing failures.`);
if (failures.length) {
  console.log(JSON.stringify(failures.slice(0, 12), null, 2));
  process.exitCode = 1;
}
