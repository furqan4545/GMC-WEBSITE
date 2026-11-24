import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, webkit } from 'playwright';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.GMC_PREVIEW_URL || 'http://127.0.0.1:4178' },
    engine: { type: 'string', default: 'both' },
    workers: { type: 'string', default: '4' },
    'phone-width': { type: 'string', default: '390' },
    path: { type: 'string', multiple: true },
    limit: { type: 'string' },
    retry: { type: 'string' },
    output: { type: 'string' },
  },
});
const base = new URL(values.url);
if (!['http:', 'https:'].includes(base.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
    base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('--url must be a local HTTP(S) server origin.');
}
const phoneWidth = Number(values['phone-width']);
if (!Number.isInteger(phoneWidth) || phoneWidth < 280 || phoneWidth > 600) {
  throw new Error('--phone-width must be between 280 and 600.');
}
const plans = {
  desktop: { browser: chromium, viewport: { width: 1440, height: 900 }, isMobile: false },
  phone: { browser: webkit, viewport: { width: phoneWidth, height: 844 }, isMobile: true },
};
const engines = values.engine === 'both' ? ['desktop', 'phone'] : [values.engine];
if (engines.some(name => !Object.hasOwn(plans, name))) throw new Error('--engine must be desktop, phone, or both.');
const concurrency = Number(values.workers);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('--workers must be between 1 and 8.');

const manifest = JSON.parse(await readFile(new URL('../content/manifest.json', import.meta.url), 'utf8'));
const paths = values.path || Object.keys(manifest.pages);
for (const path of paths) {
  if (!Object.hasOwn(manifest.pages, path)) throw new Error(`Path is absent from the prepared manifest: ${path}`);
}
const limit = values.limit === undefined ? paths.length : Number(values.limit);
if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be positive.');

const resultsKey = (engine, path) => `${engine} ${path}`;
let retry = null;
if (values.retry) {
  const history = (await readFile(values.retry, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const completed = new Map(history.filter(row => row.type === 'result').map(row => [resultsKey(row.engine, row.path), row]));
  const start = history.find(row => row.type === 'start');
  if (!start?.jobs) throw new Error('--retry requires a site layout report.');
  retry = new Set(start.jobs.filter(({ engine, path }) => completed.get(resultsKey(engine, path))?.passed !== true)
    .map(({ engine, path }) => resultsKey(engine, path)));
}
const jobs = engines.flatMap(engine => [...new Set(paths)]
  .filter(path => !retry || retry.has(resultsKey(engine, path))).slice(0, limit).map(path => ({ engine, path })));

const output = resolve(values.output || `artifacts/site-layout-${values.engine}.ndjson`);
if (values.retry && output === resolve(values.retry)) throw new Error('--output must differ from the retry report.');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({
  type: 'start',
  origin: base.origin,
  viewports: Object.fromEntries(engines.map(engine => [engine, plans[engine].viewport])),
  jobs,
}) + '\n');
const startedAt = performance.now();
console.log(`Checking ${jobs.length} page and browser combinations with up to ${concurrency} workers.`);

async function scrollContent() {
  const main = document.querySelector('#gmc-main, main.site-main, [role="main"], main');
  if (!main) return;
  const lower = [...main.querySelectorAll('.gmc-related, .elementor-element-f26b132, .gmc-collection-pages')];
  for (const more of main.querySelectorAll('details.gmc-related-more:not([open])')) {
    more.querySelector(':scope > summary')?.click();
  }
  const media = [...main.querySelectorAll('img[loading="lazy"], img[data-lazy-src], img[data-src]')];
  const nextFrame = () => new Promise(resolve => {
    const timer = setTimeout(resolve, 80);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  const positions = new Set();
  for (const element of [...media, ...lower]) {
    const box = element.getBoundingClientRect();
    if (box.width < 24 || box.height < 18 || !element.checkVisibility({ visibilityProperty: true })) continue;
    positions.add(Math.floor((scrollY + box.top) / (innerHeight * .75)) * (innerHeight * .75));
  }
  for (const position of [...positions].sort((a, b) => a - b)) {
    if (Math.abs(position - scrollY) < 10) continue;
    scrollTo({ top: position, behavior: 'instant' });
    await nextFrame();
  }
  const section = lower.findLast(element => element.checkVisibility({ visibilityProperty: true })) || main.lastElementChild;
  section?.scrollIntoView({ block: 'center', behavior: 'instant' });
  await nextFrame();
  if (document.fonts.status === 'loading') {
    await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 350))]);
  }
}

function inspectLayout() {
  const issues = [];
  const notes = [];
  const links = [];
  const metrics = { viewport: innerWidth, document: document.documentElement.scrollWidth };
  const visible = element => {
    if (!element?.checkVisibility({ visibilityProperty: true })) return false;
    const box = element.getBoundingClientRect();
    return box.width > 1 && box.height > 1;
  };
  const add = (code, description, detail) => issues.push({ code, description, ...(detail === undefined ? {} : { detail }) });
  const main = document.querySelector('#gmc-main, main.site-main, [role="main"], main');
  const header = document.querySelector('header.gmc-header');
  const titles = [...document.head.querySelectorAll('title')];
  if (titles.length !== 1 || !titles[0].textContent.trim()) add('document-title', 'Expected a single nonempty page title.');
  if (!visible(header)) add('header', 'The main navigation header is missing or invisible.');
  if (!visible(main)) add('main', 'The main content is missing or invisible.');
  if (metrics.document > metrics.viewport + 2) {
    add('viewport', 'The document exceeds the viewport width.', metrics);
  }
  if (!main) return { issues, notes, metrics, links };

  const article = main.matches('.gmc-article-page') ? main : main.querySelector('.gmc-article-page');
  const headings = [...main.querySelectorAll('h1')].filter(heading => heading.textContent.trim() && visible(heading));
  metrics.headings = headings.length;
  if (headings.length !== 1) add('main-heading', 'Expected one visible main heading.', headings.length);

  const isManagedOverflow = element => {
    for (let parent = element.parentElement; parent && parent !== main; parent = parent.parentElement) {
      if (/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(parent).overflowX)) return true;
    }
    return !!element.closest('dialog, [aria-hidden="true"], .swiper-wrapper, .slick-track, [role="tablist"]');
  };
  const content = article?.querySelector('.elementor-widget-theme-post-content') || main;
  const clipped = [...content.querySelectorAll('p, h1, h2, h3, h4, img, figure, table, iframe, video')].filter(element => {
    const box = element.getBoundingClientRect();
    return (box.left < -2 || box.right > innerWidth + 2) && visible(element) && !isManagedOverflow(element);
  });
  if (clipped.length) {
    add('content-overflow', 'Visible content exceeds the viewport without a scrollable container.',
      clipped.slice(0, 8).map(element => ({ tag: element.localName, className: element.getAttribute('class'), width: Math.round(element.getBoundingClientRect().width) })));
  }

  const media = [...main.querySelectorAll('img'), ...(header?.querySelectorAll('.gmc-logo img') || [])];
  metrics.images = media.length;
  const broken = new Set();
  const external = new Set();
  for (const image of media) {
    const box = image.getBoundingClientRect();
    if (box.width < 24 || !visible(image)) continue;
    const src = image.currentSrc || image.getAttribute('src');
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
    const url = new URL(src, location.href);
    if (url.origin !== location.origin) {
      if (/^https?:$/.test(url.protocol)) external.add(url.origin);
      continue;
    }
    if (image.complete && image.naturalWidth === 0) broken.add(url.pathname + url.search);
  }
  if (broken.size) add('broken-image', 'A visible same-site image failed to decode.', [...broken]);
  if (external.size) notes.push({ code: 'external-image', description: 'External images excluded from this local run.', hosts: [...external] });

  const legacy = main.querySelector('.elementor-element-f26b132');
  if (visible(legacy) && legacy.querySelector('.e-loop-item')) {
    add('legacy-related', 'Legacy related carousel is still visible.');
  }
  for (const related of [...main.querySelectorAll('.gmc-related')].filter(visible)) {
    const grids = [...related.querySelectorAll('.gmc-related-grid')].filter(visible);
    if (!grids.length) add('related-grid', 'Related cards grid is missing or invisible.');
    if (grids.some(grid => grid.scrollWidth > grid.clientWidth + 2)) add('related-overflow', 'Related cards exceed the grid width.');
    const cards = [...related.querySelectorAll('.gmc-related-card')].filter(visible);
    metrics.relatedCards = (metrics.relatedCards || 0) + cards.length;
    if (!cards.length) add('related-cards', 'Related section has no visible cards.');
    const more = related.querySelector('details.gmc-related-more');
    if (more) {
      const summary = more.querySelector('summary');
      if (!visible(summary) || !more.open) add('related-disclosure', 'Additional related cards could not be opened.');
      else if (summary.getBoundingClientRect().height < 43) add('related-disclosure-target', 'Related disclosure target is shorter than 44 pixels.');
    }
    const destinations = new Set();
    for (const card of cards) {
      const bounds = card.getBoundingClientRect();
      const photo = card.querySelector('img');
      const href = card.getAttribute('href')?.trim();
      if (!card.matches('a') || !href || href.startsWith('#') ||
          !URL.canParse(card.href) || !/^https?:$/.test(new URL(card.href).protocol)) {
        add('related-link', 'Related card lacks a usable article link.');
      } else if (destinations.has(card.href)) {
        add('related-duplicate', 'Related section repeats a resolved destination.', card.href);
      } else {
        destinations.add(card.href);
      }
      if (bounds.height > 380 || bounds.left < -2 || bounds.right > innerWidth + 2) {
        add('related-card-size', 'Related card exceeds compact or viewport bounds.', { width: Math.round(bounds.width), height: Math.round(bounds.height) });
      }
      if (visible(photo) && getComputedStyle(photo).objectFit !== 'contain') add('related-photo-fit', 'Related photo is not displayed at its natural proportions.');
    }
  }
  const linkGroups = {
    header: '.gmc-header a',
    collections: '.gmc-collection-pages a, .gmc-collection-gallery a, .elementor-widget-archive-posts .elementor-posts-container .elementor-post__title a',
    related: '.gmc-related-card',
  };
  for (const [group, selector] of Object.entries(linkGroups)) {
    for (const anchor of document.querySelectorAll(selector)) {
      const raw = anchor.getAttribute('href')?.trim();
      if (!raw || !URL.canParse(raw, location.href)) {
        add('runtime-link', 'Generated public link has no usable destination.', { group, text: anchor.textContent.trim() });
        continue;
      }
      const target = new URL(raw, location.href);
      const href = target.origin === location.origin ? target.pathname + target.search + target.hash : target.href;
      links.push({ group, href, current: anchor.getAttribute('aria-current') === 'page' });
    }
  }
  return { issues, notes, metrics, links };
}

async function navigateAndInspect(page, path) {
  const response = await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  const status = response?.status();
  if (status !== 200) return { status, issues: [{ code: 'http', description: `Expected HTTP 200, got ${status ?? 'no response'}.` }], notes: [] };

  await page.waitForFunction(() => document.body.classList.contains('gmc-layout-ready'), undefined, { timeout: 6500 })
    .catch(error => {
      if (error.name !== 'TimeoutError') throw error;
    });
  await page.evaluate(scrollContent);
  const layout = await page.evaluate(inspectLayout);
  if (new URL(page.url()).pathname !== path) layout.issues.unshift({ code: 'redirect', description: 'Manifest path unexpectedly redirected.' });
  if (layout.issues.some(issue => issue.code === 'broken-image')) {
    await page.waitForTimeout(160);
    const after = await page.evaluate(inspectLayout);
    layout.issues = layout.issues.filter(issue => issue.code !== 'broken-image');
    layout.issues.push(...after.issues.filter(issue => issue.code === 'broken-image'));
  }
  return { status, ...layout };
}

const counters = { completed: 0, failed: 0, navigationErrors: 0 };
const observedLinks = new Map();
async function checkPage(page, job) {
  const started = performance.now();
  let result;
  try {
    try {
      result = await navigateAndInspect(page, job.path);
    } catch (error) {
      if (!/Execution context was destroyed|interrupted by another navigation|net::ERR_ABORTED/.test(error.message)) throw error;
      result = await navigateAndInspect(page, job.path);
    }
  } catch (error) {
    counters.navigationErrors++;
    result = { issues: [{ code: 'browser-error', description: error.message.split('\n')[0] }], notes: [] };
  }
  const passed = result.issues.length === 0;
  if (!passed) counters.failed++;
  const { links = [], ...checks } = result;
  for (const { group, href, current } of links) {
    const key = group + ' ' + href;
    const entry = observedLinks.get(key) || { group, href, occurrences: 0, current: 0, example: job.path };
    entry.occurrences++;
    if (current) entry.current++;
    observedLinks.set(key, entry);
  }
  const record = { type: 'result', ...job, passed, milliseconds: Math.round(performance.now() - started), ...checks };
  await appendFile(output, JSON.stringify(record) + '\n');
  if (++counters.completed % 50 === 0) console.log(`Checked ${counters.completed}/${jobs.length}, ${counters.failed} require review.`);
}

async function runEngine(engine, workers, queue) {
  if (!queue.length) return;
  const { browser: browserType, viewport, isMobile } = plans[engine];
  const browser = await browserType.launch();
  let cursor = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, async () => {
      const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, reducedMotion: 'reduce', serviceWorkers: 'block' });
      await context.route('**/*', route => {
        const request = route.request();
        return new URL(request.url()).origin === base.origin && ['GET', 'HEAD'].includes(request.method()) ? route.continue() : route.abort();
      });
      try {
        const page = await context.newPage();
        while (cursor < queue.length) await checkPage(page, queue[cursor++]);
      } finally {
        await context.close();
      }
    }));
  } finally {
    await browser.close();
  }
}

if (engines.length === 2 && concurrency > 1) {
  await Promise.all(engines.map((engine, index) => runEngine(engine,
    index === 0 ? Math.ceil(concurrency / 2) : Math.floor(concurrency / 2), jobs.filter(job => job.engine === engine))));
} else {
  for (const engine of engines) await runEngine(engine, concurrency, jobs.filter(job => job.engine === engine));
}
const summary = { type: 'summary', total: jobs.length, ...counters, seconds: Math.round((performance.now() - startedAt) / 1000) };
await appendFile(output, JSON.stringify({ type: 'runtime-links', links: [...observedLinks.values()] }) + '\n');
await appendFile(output, JSON.stringify(summary) + '\n');
console.log(JSON.stringify(summary));
console.log(`Report saved to ${output}`);
if (counters.failed) process.exitCode = 1;
