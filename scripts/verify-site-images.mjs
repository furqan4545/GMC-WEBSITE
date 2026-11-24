import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { load } from 'cheerio';
import { chromium, webkit } from 'playwright';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.GMC_PREVIEW_URL || 'http://127.0.0.1:3000' },
    output: { type: 'string', default: 'artifacts/site-images-no-rocket.json' },
  },
});
const base = new URL(values.url);
if (!['http:', 'https:'].includes(base.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
    base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('--url must be a local HTTP(S) server origin.');
}

const footer = '.elementor-location-footer';
const content = '.elementor-widget-theme-post-content';
const imageRoot = '/wp-content/uploads/';
const accreditation = [
  ['.wp-image-2995', '2025/08/gangnam-medical-concierge-plastic-surgery-agency-medical-korea-logo.svg'],
  ['.wp-image-2996', '2025/08/gangnam-medical-concierge-plastic-surgery-agency-seoul-metropolitan-logo.svg'],
  ['.wp-image-2997', '2025/08/gangnam-medical-concierge-plastic-surgery-agency-gangnam-gu-district-logo.svg'],
  ['.wp-image-2998', '2025/08/gangnam-medical-concierge-plastic-surgery-agency-kahf-korean-accreditation-program-for-dospitals-serving-foreign-patients-logo.jpg'],
];
const articleImages = ['2026/06/Image-10.jpg', '2026/06/Image-6-1.jpg', '2026/06/Image-13.jpg'];
const mapSelector = footer + ' .elementor-widget-google_maps iframe';
const address = '710A, Teheran-ro 64-gil 13, Gangnam-gu, Seoul';
const locales = ['en', 'zh', 'tw', 'id', 'th', 'ru'];

function mapUrl(raw) {
  if (!raw || !URL.canParse(raw, base)) return false;
  const url = new URL(raw, base);
  return url.protocol === 'https:' && url.hostname === 'maps.google.com' && url.pathname === '/maps' &&
    url.searchParams.get('q') === address && url.searchParams.get('output') === 'embed';
}

function imageUrl(raw, expected) {
  if (!raw || !URL.canParse(raw, base)) return false;
  const url = new URL(raw, base);
  return url.origin === base.origin && url.pathname === imageRoot + expected;
}

function shortUrl(raw) {
  return raw?.startsWith('data:') ? 'data: placeholder' : raw || '(missing)';
}

async function inspectImage(locator, expected, markup, result) {
  if (!imageUrl(markup, expected)) {
    result.issues.push({ check: 'initial image source', expected, actual: shortUrl(markup) });
  }
  if (await locator.count() !== 1) {
    result.issues.push({ check: 'image element', expected, actual: await locator.count() });
    return;
  }
  await locator.scrollIntoViewIfNeeded({ timeout: 4000 });
  const observed = await locator.evaluate(async image => {
    image.scrollIntoView({ block: 'center', behavior: 'instant' });
    const until = performance.now() + 3000;
    while ((!image.complete || !image.naturalWidth) && performance.now() < until) {
      if (!image.isConnected) throw new Error('Element is not attached to the DOM');
      await new Promise(resolve => setTimeout(resolve, 65));
    }
    if (!image.isConnected) throw new Error('Element is not attached to the DOM');
    const decoded = await Promise.race([
      image.decode().then(() => true, () => false),
      new Promise(resolve => setTimeout(() => resolve(false), 2500)),
    ]);
    return { src: image.currentSrc, decoded, complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
  });
  if (!imageUrl(observed.src, expected) || !observed.decoded || !observed.naturalWidth || !observed.naturalHeight) {
    result.issues.push({ check: 'real image decoded', expected, actual: shortUrl(observed.src), complete: observed.complete,
      decoded: observed.decoded, size: [observed.naturalWidth, observed.naturalHeight] });
  } else result.imagesDecoded++;
}

async function inspectCover(page, result) {
  const cover = page.locator('.gmc-article-cover').first();
  if (!await cover.count()) {
    result.issues.push({ check: 'visible article cover decoded', actual: '(missing)' });
    return;
  }
  try {
    await cover.scrollIntoViewIfNeeded({ timeout: 4000 });
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    result.issues.push({ check: 'visible article cover decoded', actual: '(unreachable)' });
    return;
  }
  const observed = await cover.evaluate(async element => {
    const photo = element.querySelector('img');
    const background = getComputedStyle(element).backgroundImage;
    const src = photo?.currentSrc || /url\(["']?([^"')]+)["']?\)/.exec(background)?.[1];
    const height = Math.round(element.getBoundingClientRect().height);
    if (!src || new URL(src, location.href).origin !== location.origin) return { src, height, decoded: false };
    const image = new Image();
    image.src = src;
    const decoded = await Promise.race([
      image.decode().then(() => image.naturalWidth > 0, () => false),
      new Promise(resolve => setTimeout(() => resolve(false), 2500)),
    ]);
    return { src, height, decoded };
  });
  if (!observed.decoded || observed.height < 40 || !new URL(observed.src, base).pathname.startsWith(imageRoot)) {
    result.issues.push({ check: 'visible article cover decoded', height: observed.height, actual: shortUrl(observed.src) });
  } else result.coverDecoded = true;
}

async function inspectRoute(page, path, result) {
  const response = await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded', timeout: 15000 });
  result.status = response?.status();
  if (result.status !== 200) throw new Error(`Expected HTTP 200, got ${result.status}`);
  const $ = load(await response.text());
  await page.waitForFunction(() =>
    document.body.classList.contains('gmc-layout-ready') &&
    getComputedStyle(document.body).getPropertyValue('--gmc-paper').trim(), undefined, { timeout: 7000 });
  await inspectCover(page, result);

  for (const [index, expected] of articleImages.entries()) {
    await inspectImage(page.locator(content + ' img').nth(index), expected, $(content + ' img').eq(index).attr('src'), result);
  }
  for (const [selector, expected] of accreditation) {
    const full = footer + ' ' + selector;
    await inspectImage(page.locator(full), expected, $(full).attr('src'), result);
  }

  const iframe = page.locator(mapSelector);
  const markupMap = $(mapSelector).attr('src');
  if (!mapUrl(markupMap)) result.issues.push({ check: 'initial map source', actual: shortUrl(markupMap) });
  if (await iframe.count() !== 1 || !mapUrl(await iframe.getAttribute('src'))) {
    result.issues.push({ check: 'live map source' });
  } else {
    await iframe.scrollIntoViewIfNeeded({ timeout: 4000 });
    try {
      await page.frameLocator(mapSelector).locator('#gmc-maps-fixture').waitFor({ timeout: 5000 });
      result.mapLoaded = true;
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error;
      result.issues.push({ check: 'map iframe navigated' });
    }
  }
}

async function run(browserType, engine, contextOptions) {
  const browser = await browserType.launch();
  const context = await browser.newContext({ ...contextOptions, reducedMotion: 'reduce', serviceWorkers: 'block' });
  let blockedRocket = 0;
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (/\/wp-rocket\/.*lazyload/i.test(url.pathname)) {
      blockedRocket++;
      return route.abort();
    }
    if (request.method() === 'GET' && request.isNavigationRequest() && mapUrl(url.href)) {
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<main id="gmc-maps-fixture">Map embed fixture</main>' });
    }
    return url.origin === base.origin && ['GET', 'HEAD'].includes(request.method()) ? route.continue() : route.abort();
  });
  try {
    const page = await context.newPage();
    const results = [];
    for (const locale of locales) {
      const path = (locale === 'en' ? '' : '/' + locale) + '/plastic-surgery/gum-contouring/';
      const result = { engine, locale, path, imagesDecoded: 0, coverDecoded: false, mapLoaded: false, issues: [] };
      const initialBlocked = blockedRocket;
      try {
        await inspectRoute(page, path, result);
      } catch (error) {
        if (/Execution context was destroyed|interrupted by another navigation|Element is not attached to the DOM/.test(error.message)) {
          result.issues = [];
          result.imagesDecoded = 0;
          result.coverDecoded = false;
          result.mapLoaded = false;
          try {
            await inspectRoute(page, path, result);
          } catch (retryError) {
            result.issues.push({ check: 'browser', error: retryError.message.split('\n')[0] });
          }
        } else result.issues.push({ check: 'browser', error: error.message.split('\n')[0] });
      }
      result.rocketRequestsBlocked = blockedRocket - initialBlocked;
      results.push(result);
    }
    return results;
  } finally {
    await browser.close();
  }
}

const cases = (await Promise.all([
  run(chromium, 'desktop-chromium', { viewport: { width: 1440, height: 900 } }),
  run(webkit, 'phone-webkit', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }),
])).flat();
const passed = cases.filter(result => result.issues.length === 0).length;
const output = resolve(values.output);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ origin: base.origin, passed, cases }, null, 2) + '\n');
console.log(JSON.stringify({ passed, total: cases.length, decodedImages: cases.reduce((count, result) => count + result.imagesDecoded, 0),
  decodedCovers: cases.filter(result => result.coverDecoded).length, loadedMapFixtures: cases.filter(result => result.mapLoaded).length,
  rocketRequestsBlocked: cases.reduce((count, result) => count + result.rocketRequestsBlocked, 0), report: output }));
if (passed !== cases.length) process.exitCode = 1;
