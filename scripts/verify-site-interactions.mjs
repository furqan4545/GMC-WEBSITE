import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { chromium, devices, webkit } from 'playwright';

const { values } = parseArgs({ options: {
  url: { type: 'string', default: process.env.GMC_PREVIEW_URL || 'http://127.0.0.1:4178' },
  engine: { type: 'string', default: 'both' },
  locale: { type: 'string', multiple: true },
  flow: { type: 'string', multiple: true },
} });
const base = new URL(values.url);
if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
    base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('--url must be a local HTTP(S) server origin.');
}

const original = 'https://gangnammedicalconcierge.com';
const languages = [
  { code: 'en', path: '/', lang: 'en' },
  { code: 'zh', path: '/zh/', lang: 'zh' },
  { code: 'tw', path: '/tw/', lang: 'zh-TW' },
  { code: 'id', path: '/id/', lang: 'id' },
  { code: 'th', path: '/th/', lang: 'th' },
  { code: 'ru', path: '/ru/', lang: 'ru' },
];
const browsers = {
  desktop: { engine: chromium, options: { viewport: { width: 1440, height: 900 } } },
  phone: { engine: webkit, options: devices['iPhone 13'] },
};
const selectedEngines = values.engine === 'both' ? Object.keys(browsers) : [values.engine];
assert.ok(selectedEngines.every(name => Object.hasOwn(browsers, name)), '--engine must be desktop, phone, or both.');
const locales = languages.filter(language => !values.locale || values.locale.includes(language.code));
assert.ok(locales.length && (!values.locale || values.locale.every(code => locales.some(locale => locale.code === code))), 'Unknown locale.');

const readCollection = async name => JSON.parse(await readFile(new URL(`../public/gmc-preview/collections/${name}.json`, import.meta.url), 'utf8'));
const galleryEntries = await readCollection('gallery');
const articleIndexes = new Map(await Promise.all(locales.map(async locale => [locale.code, await readCollection(locale.code)])));

async function go(page, path) {
  const result = await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded' });
  assert.equal(result?.status(), 200, path);
  assert.equal(new URL(page.url()).pathname, new URL(path, base).pathname);
  await page.locator('.gmc-header').waitFor();
}

async function visibleDetails(locator, expected) {
  assert.equal(await locator.evaluate(node => node.open), expected);
}

async function checkNavigation(page, locale) {
  await go(page, locale.path);
  const skip = page.locator('.gmc-skip');
  const target = await skip.getAttribute('href');
  assert.ok(target?.startsWith('#'));
  assert.equal(await page.locator(target).count(), 1);
  await skip.focus();
  assert.ok(await skip.evaluate(node => document.activeElement === node));
  await skip.press('Enter');
  await page.waitForURL(url => url.hash === target);

  const toggle = page.locator('.gmc-menu-toggle');
  const handset = await toggle.isVisible();
  if (handset) {
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.press('Enter');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.ok(await page.evaluate(() => Boolean(document.activeElement.closest('.gmc-nav'))));
  }

  const about = page.locator('.gmc-about-menu');
  await about.locator(':scope > summary').press('Enter');
  await visibleDetails(about, true);
  assert.ok(await about.locator('a:visible').count() > 0);
  await about.locator(':scope > summary').press('Escape');
  await visibleDetails(about, false);

  const treatments = page.locator('.gmc-treatment-menu');
  const openTreatments = treatments.locator(':scope > summary');
  await openTreatments.press('Enter');
  const groups = treatments.locator('.gmc-treatment-group');
  assert.equal(await groups.count(), 4);
  let reachableTreatments = 0;
  for (const group of await groups.all()) {
    const summary = group.locator(':scope > summary');
    await summary.press('Enter');
    const links = group.locator('a:visible');
    assert.ok(await links.count() > 0);
    reachableTreatments += await links.count();
    await summary.press('Escape');
    await visibleDetails(group, false);
    assert.ok(await summary.evaluate(node => document.activeElement === node));
  }
  await openTreatments.press('Escape');
  await visibleDetails(treatments, false);

  const picker = page.locator('.gmc-language-menu > summary');
  await picker.press('Enter');
  const links = page.locator('.gmc-languages a');
  assert.equal(await links.count(), languages.length);
  assert.equal(await page.locator('.gmc-languages a[aria-current]').count(), 1);
  for (const language of languages) {
    const anchor = page.locator(`.gmc-languages a[lang="${language.lang}"]`);
    assert.equal(new URL(await anchor.getAttribute('href'), base).href, new URL(language.path, base).href);
  }
  const destination = languages[(languages.indexOf(locale) + 1) % languages.length];
  await Promise.all([
    page.waitForURL(new URL(destination.path, base).href),
    page.locator(`.gmc-languages a[lang="${destination.lang}"]`).click(),
  ]);
  await page.locator('.gmc-languages a[aria-current]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('.gmc-languages a[aria-current]').getAttribute('lang'), destination.lang);
  if (handset) assert.equal(await page.locator('.gmc-menu-toggle').getAttribute('aria-expanded'), 'false');
  return reachableTreatments;
}

async function checkHome(page, locale) {
  await go(page, locale.path);
  const treatments = page.locator('.gmc-hero-actions a[href^="#"]');
  const destination = await treatments.getAttribute('href');
  await treatments.press('Enter');
  await page.waitForURL(url => url.hash === destination);
  const treatmentCards = page.locator(`${destination} .gmc-treatment-card[href]`);
  assert.equal(await treatmentCards.count(), 10);

  const triggers = page.locator('.gmc-photo-grid .gmc-photo-trigger');
  assert.ok(await triggers.count() > 0);
  const result = await triggers.evaluateAll(async nodes => {
    const dialog = document.querySelector('.gmc-photo-dialog');
    const image = dialog.querySelector('img');
    const closer = dialog.querySelector('.gmc-photo-close');
    const failures = [];
    for (const trigger of nodes) {
      trigger.click();
      if (!dialog.open || image.getAttribute('src') !== trigger.dataset.photoSrc) failures.push('A homepage photo did not open from its original source.');
      if (trigger === nodes[0]) await image.decode();
      const closed = new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
      closer.click();
      await closed;
      if (dialog.open || document.activeElement !== trigger) failures.push('Closing a homepage photo did not restore focus.');
    }
    return { photos: nodes.length, failures };
  });
  assert.deepEqual(result.failures, []);
  const reviews = page.locator('.gmc-review');
  assert.equal(await reviews.count(), await page.locator('.ti-reviews-container-wrapper > .ti-review-item').count());
  assert.ok(await reviews.count() > 0);
  return { treatments: 10, photos: result.photos, reviews: await reviews.count() };
}

async function checkFaq(page, locale) {
  await go(page, `${locale.path}faqs/`);
  await page.locator('.e-n-tabs.e-activated').first().waitFor();
  const tabs = page.locator('.e-n-tabs-heading [role="tab"]');
  assert.ok(await tabs.count() > 0);
  const touch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  let questions = 0;
  const controls = await tabs.evaluateAll(nodes => nodes.map(node => ({ id: node.id, panel: node.getAttribute('aria-controls') })));
  for (const { id, panel } of controls) {
    const tab = page.locator(`#${id}`);
    if (await tab.getAttribute('aria-selected') !== 'true') {
      if (touch) await tab.tap();
      else await tab.click();
    }
    await page.locator(`#${id}[aria-selected="true"]`).waitFor();
    assert.equal(await tab.getAttribute('aria-selected'), 'true');
    const active = page.locator(`#${panel}`);
    await active.waitFor();
    const result = await active.evaluate(async section => {
      const summaries = [...section.querySelectorAll('details.e-n-accordion-item > summary')];
      const failures = [];
      const groups = new Map();
      for (const summary of summaries) {
        const accordion = summary.closest('.e-n-accordion') || section;
        if (!groups.has(accordion)) groups.set(accordion, []);
        groups.get(accordion).push(summary);
      }
      const waitUntil = async condition => {
        const deadline = performance.now() + 2000;
        while (!condition() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 16));
        return condition();
      };
      await Promise.all([...groups.values()].map(async group => {
        for (const summary of group) {
          const details = summary.parentElement;
          if (summary.getAttribute('aria-expanded') === 'true') summary.click();
          if (!await waitUntil(() => !details.open)) failures.push(summary.textContent.trim());
          summary.click();
          if (!await waitUntil(() => details.open && summary.getAttribute('aria-expanded') === 'true')) failures.push(summary.textContent.trim());
          summary.click();
          if (!await waitUntil(() => !details.open && summary.getAttribute('aria-expanded') === 'false')) failures.push(summary.textContent.trim());
        }
      }));
      return { count: summaries.length, failures };
    });
    assert.ok(result.count > 0, panel);
    assert.deepEqual(result.failures, [], panel);
    questions += result.count;
  }
  return { tabs: controls.length, questions };
}

async function checkGallery(page, locale) {
  const path = `${locale.path}bna-gallery/`;
  await go(page, path);
  await page.locator('.gmc-collection-tile').first().waitFor();
  const result = await page.evaluate(entries => {
    const inputs = [...document.querySelectorAll('.jet-color-image-list__input')];
    const failures = [];
    const grid = document.querySelector('.gmc-collection-gallery');
    const pager = document.querySelector('.gmc-collection-pages');
    const path = value => new URL(value, location.origin).pathname;
    let pages = 0;
    let photosOpened = 0;
    let filteredResults = 0;
    for (const input of inputs) {
      input.click();
      if (!input.checked) failures.push(`${input.value} did not select`);
      const expected = input.value === 'all' ? entries : entries.filter(row => row.categories.includes(input.value));
      if (!expected.length) {
        if (!grid.querySelector('[role="status"]') || !pager.hidden) failures.push(`${input.value} has no empty state`);
        continue;
      }
      const total = Math.ceil(expected.length / 6);
      for (let index = 1; index <= total; index++) {
        const offset = (index - 1) * 6;
        const tiles = [...grid.querySelectorAll('.gmc-collection-tile')];
        const desired = expected.slice(offset, offset + 6).map(row => path(row.image));
        const actual = tiles.map(tile => path(tile.querySelector('img').getAttribute('src')));
        if (actual.join('|') !== desired.join('|')) failures.push(`${input.value} page ${index} differs from saved gallery order`);
        filteredResults += tiles.length;
        if (input.value === 'all') {
          for (const [position, tile] of tiles.entries()) {
            tile.click();
            const dialog = document.querySelector('.gmc-collection-photo');
            if (!dialog?.open || path(dialog.querySelector('img').src) !== desired[position]) {
              failures.push(`photo ${offset + position + 1} did not open`);
            }
            dialog?.querySelector('button').click();
            if (dialog?.open) failures.push(`photo ${offset + position + 1} did not close`);
            photosOpened++;
          }
        }
        if (index < total) {
          const next = [...pager.querySelectorAll('a[href]')].find(anchor => Number(new URL(anchor.href).searchParams.get('pagenum')) === index + 1);
          if (!next) { failures.push(`${input.value} lacks a link for page ${index + 1}`); break; }
          next.click();
        }
        pages++;
      }
    }
    inputs.find(input => input.value === 'all').click();
    if (location.search || grid.querySelectorAll('.gmc-collection-tile').length !== 6) failures.push('All did not reset the gallery.');
    return { filters: inputs.length, pages, photosOpened, filteredResults, failures };
  }, galleryEntries);
  assert.deepEqual(result.failures, []);
  assert.equal(result.filters, 10);
  assert.equal(result.photosOpened, galleryEntries.length);
  const deepLink = `${path}?jsf=jet-engine:list-2&tax=category%3A11&pagenum=2`;
  await go(page, deepLink);
  const photo = page.locator('.gmc-collection-tile').first();
  await photo.waitFor();
  assert.equal(await page.locator('.jet-color-image-list__input[value="11"]').isChecked(), true);
  await photo.press('Enter');
  const dialog = page.locator('.gmc-collection-photo[open]');
  await dialog.waitFor();
  await dialog.locator('img').evaluate(image => image.decode());
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 0);
  return result;
}

async function checkArchive(page, locale) {
  const path = `${locale.path}all-blog-posts/`;
  await go(page, path);
  const heading = page.locator('.gmc-inner-page > .gmc-page-title');
  const label = await heading.textContent();
  await page.locator('.gmc-collection-pages').waitFor();
  const actual = await page.evaluate(() => {
    const root = document.querySelector('.elementor-widget-archive-posts');
    const pager = document.querySelector('.gmc-collection-pages');
    const pages = Math.max(...[...pager.querySelectorAll('a[href]')].map(anchor => Number(new URL(anchor.href).searchParams.get('pagenum'))));
    const paths = [];
    for (let number = 1; number <= pages; number++) {
      paths.push(...[...root.querySelectorAll('.elementor-post__title a[href]')].map(anchor => new URL(anchor.href).pathname));
      if (number === pages) continue;
      const link = [...pager.querySelectorAll('a[href]')].find(anchor => Number(new URL(anchor.href).searchParams.get('pagenum')) === number + 1);
      if (!link) throw new Error(`No archive link for page ${number + 1}`);
      link.click();
    }
    return { pages, paths };
  });
  const index = articleIndexes.get(locale.code);
  assert.deepEqual([...actual.paths].sort(), index.map(article => article.route).sort());
  assert.equal(new Set(actual.paths).size, actual.paths.length);
  await page.goBack();
  assert.equal(new URL(page.url()).searchParams.get('pagenum'), String(actual.pages - 1));
  await go(page, `${path}?jsf=epro-archive&pagenum=${actual.pages}`);
  await page.locator('.gmc-collection-pages [aria-current="page"]').waitFor();
  const current = await page.locator('.gmc-collection-pages [aria-current="page"]').getAttribute('href');
  assert.equal(new URL(current, base).searchParams.get('pagenum'), String(actual.pages));
  await go(page, `${path}page/2/`);
  await heading.waitFor();
  assert.equal(await heading.textContent(), label);
  return { pages: actual.pages, articleLinks: actual.paths.length };
}

async function checkDisclosures(page, locale) {
  await go(page, `${locale.path}blog/`);
  const weekly = page.locator('.gmc-blog-featured');
  await weekly.waitFor();
  const more = weekly.locator('.gmc-blog-more');
  assert.equal(await weekly.locator('a:visible').count(), 3);
  await more.locator('summary').press('Enter');
  await visibleDetails(more, true);
  const blogLinks = weekly.locator('a:visible');
  const weeklyLinks = await blogLinks.count();
  assert.equal(weeklyLinks, await weekly.locator('a[href]').count());
  assert.ok(weeklyLinks > 3);
  await more.locator('summary').press('Enter');
  await visibleDetails(more, false);

  await go(page, `${locale.path}plastic-surgery/gum-contouring/`);
  const related = page.locator('.gmc-related');
  await related.waitFor();
  const cards = related.locator('.gmc-related-card');
  const hrefs = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
  assert.ok(hrefs.every(href => href && /^https?:\/\/|^\//.test(href)));
  assert.equal(new Set(hrefs).size, hrefs.length);
  assert.equal(await related.locator('.gmc-related-card:visible').count(), Math.min(3, hrefs.length));
  if (hrefs.length > 3) {
    const disclosure = related.locator('details.gmc-related-more');
    await disclosure.locator('summary').press('Enter');
    await visibleDetails(disclosure, true);
    assert.equal(await related.locator('.gmc-related-card:visible').count(), hrefs.length);
    assert.ok(await cards.evaluateAll(nodes => nodes.every(node => {
      const bounds = node.getBoundingClientRect();
      return bounds.width > 0 && bounds.left >= -1 && bounds.right <= innerWidth + 1;
    })));
    await disclosure.locator('summary').press('Enter');
    await visibleDetails(disclosure, false);
  }
  return { weeklyLinks, relatedLinks: hrefs.length };
}

async function checkContact(page, locale) {
  const path = `${locale.path}contact/`;
  await go(page, locale.path);
  const cta = page.locator('.gmc-header-cta');
  assert.equal(new URL(await cta.getAttribute('href'), base).href, new URL(path, base).href);
  await Promise.all([page.waitForURL(new URL(path, base).href), cta.click()]);
  const bridge = page.locator('.elementor-widget-form a.gmc-button');
  await bridge.waitFor();
  assert.equal(await bridge.count(), 1);
  assert.equal(await bridge.getAttribute('href'), new URL(path, original).href);
  assert.equal(await page.locator('form.elementor-form').count(), 0);
}

async function checkArticleBookmarks(page, locale) {
  const pages = bookmarkIndex.get(locale.code);
  assert.ok(pages.length > 0);
  let count = 0;
  for (const path of pages) {
    await go(page, path);
    const bookmarks = page.locator('.wp-block-rank-math-toc-block a[href^="#"]');
    assert.ok(await bookmarks.count() > 0, path);
    const first = bookmarks.first();
    const fragment = new URL(await first.getAttribute('href'), base).hash;
    await Promise.all([page.waitForURL(url => url.hash === fragment), first.click()]);
    const result = await bookmarks.evaluateAll(async anchors => {
      const failures = [];
      for (const anchor of anchors) {
        const fragment = new URL(anchor.href).hash;
        if (!document.getElementById(decodeURIComponent(fragment.slice(1)))) failures.push(fragment);
        anchor.click();
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (location.hash !== fragment) failures.push(fragment);
      }
      return failures;
    });
    assert.deepEqual(result, [], path);
    count += await bookmarks.count();
  }
  return { pages: pages.length, bookmarks: count };
}

const checks = {
  navigation: checkNavigation,
  homepage: checkHome,
  faqs: checkFaq,
  gallery: checkGallery,
  archive: checkArchive,
  disclosures: checkDisclosures,
  contact: checkContact,
  bookmarks: checkArticleBookmarks,
};
const flows = values.flow || Object.keys(checks);
assert.ok(flows.every(flow => Object.hasOwn(checks, flow)), 'Unknown interaction flow.');

const bookmarkIndex = new Map(locales.map(locale => [locale.code, []]));
if (flows.includes('bookmarks')) {
  const content = new URL('../content/', import.meta.url);
  const { pages } = JSON.parse(await readFile(new URL('manifest.json', content), 'utf8'));
  const entries = Object.entries(pages);
  for (let start = 0; start < entries.length; start += 24) {
    await Promise.all(entries.slice(start, start + 24).map(async ([path, file]) => {
      const territory = languages.find(language => language.path !== '/' && path.startsWith(language.path)) || languages[0];
      if (!bookmarkIndex.has(territory.code)) return;
      const document = gunzipSync(await readFile(new URL(`pages/${file}`, content))).toString();
      if (/class="[^\"]*\bwp-block-rank-math-toc-block\b/.test(document)) bookmarkIndex.get(territory.code).push(path);
    }));
  }
}

const failures = [];
for (const name of selectedEngines) {
  const { engine, options } = browsers[name];
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const request = route.request();
      return new URL(request.url()).origin === base.origin && ['GET', 'HEAD'].includes(request.method()) && request.resourceType() !== 'media'
        ? route.continue() : route.abort();
    });
    for (const locale of locales) {
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      try {
        for (const flow of flows) {
          const check = checks[flow];
          try {
            const result = await check(page, locale);
            console.log(name, locale.code, check.name, 'passed', result ?? '');
          } catch (error) {
            const message = `${name} ${locale.code} ${check.name}: ${error.message}`;
            failures.push(message);
            console.error(message);
          }
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}

if (failures.length) {
  console.error(`${failures.length} interaction workflows failed.`);
  process.exitCode = 1;
}
