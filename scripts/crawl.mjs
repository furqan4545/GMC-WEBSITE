import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { load } from 'cheerio';
import { getPublic, isVerificationTitle, origin, sitemapFiles } from './source.mjs';

import { baseline, parseRecords, recordPage } from './baseline.mjs';

const ledger = new URL('crawl.ndjson', baseline);
await mkdir(baseline, { recursive: true });
const sitemapEntries = new Map();

for (const name of [...sitemapFiles, 'sitemap.xml', 'wp-sitemap.xml', 'robots.txt', 'main-sitemap.xsl', 'sitemap.xsl']) {
  const response = await getPublic('/' + name);
  if (response.status !== 200) {
    if (sitemapFiles.includes(name)) throw new Error(`${name} returned ${response.status}`);
    continue;
  }
  await writeFile(new URL(name, baseline), response.body);
  if (!sitemapFiles.slice(1).includes(name)) continue;
  const $ = load(response.body.toString(), { xml: true });
  for (const node of $('url > loc')) {
    const url = new URL($(node).text());
    if (url.origin !== origin) throw new Error(`Unrecognized sitemap origin ${url.origin}`);
    sitemapEntries.set(url.pathname + url.search, name);
  }
}

const completed = await readFile(ledger, 'utf8').catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return '';
});
const previous = parseRecords(completed);
const prioritized = ['/', '/contact/', '/blog/', '/bna-gallery/', '/faqs/', '/partners/', '/zh/', '/tw/', '/id/', '/th/', '/ru/', '/plastic-surgery/nose/', '/dental-veneers/', '/plastic-surgery/nose-job-korea/', '/our-services/'];
const byTemplate = [...sitemapEntries].sort((left, right) => {
  const order = ['page-sitemap.xml', 'category-sitemap.xml', 'post-sitemap.xml'];
  return order.indexOf(left[1]) - order.indexOf(right[1]);
}).map(([path]) => path);
const paths = [...new Set([...prioritized.filter(path => sitemapEntries.has(path)), ...byTemplate])];
const pending = paths.filter(path => !previous.get(path)?.file || !previous.get(path)?.title || isVerificationTitle(previous.get(path)?.title));
const timeout = Number(process.env.GMC_SOURCE_TIMEOUT || 9);
const workers = Number(process.env.GMC_SOURCE_WORKERS || 5);
if (process.argv.includes('--fresh')) {
  pending.splice(0, pending.length, ...pending.filter(path => !previous.has(path)));
}
await writeFile(new URL('urls.json', baseline), JSON.stringify(Object.fromEntries(sitemapEntries), null, 2));
console.log(`${paths.length} unique sitemap URLs. Fetching ${pending.length}.`);

const useBrowser = process.argv.includes('--browser');
const browser = useBrowser ? await (await import('playwright')).chromium.launch({ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }) : null;
const context = browser ? await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' }) : null;
if (context) {
  await context.route('**/*', route => {
    const request = route.request();
    if (request.isNavigationRequest() && request.method() === 'GET' && new URL(request.url()).origin === origin) {
      return route.continue();
    }
    return route.abort();
  });
}

let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interrupted = true;
    if (browser) void browser.close();
  });
}

let index = 0;
let checked = 0;
let failures = 0;
async function worker(slot) {
  await delay(slot * 200);
  const page = context ? await context.newPage() : null;
  const fetchPage = async path => {
    if (!page) return getPublic(path, timeout);
    const result = await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: timeout * 1000 });
    return {
      status: result.status(),
      destination: result.url(),
      type: result.headers()['content-type'],
      body: await result.body(),
    };
  };
  try {
    while (!interrupted && index < pending.length) {
      const path = pending[index++];
      try {
        let result = await fetchPage(path);
        if (result.status === 429 || result.status >= 500) {
          await delay(2500);
          result = await fetchPage(path);
        }
        const row = await recordPage(path, result, sitemapEntries.get(path));
        if (!row.file) failures++;
      } catch (error) {
        if (interrupted) return;
        if (browser && !browser.isConnected()) throw error;
        failures++;
        await recordPage(path, null, sitemapEntries.get(path), error.message.split('\n')[0]);
      }
      if (++checked % 100 === 0) console.log(`${checked}/${pending.length}, ${failures} response errors`);
      await delay(350);
    }
  } finally {
    if (page) await page.close();
  }
}
try {
  await Promise.all(Array.from({ length: workers }, (_, slot) => worker(slot)));
} finally {
  if (browser) await browser.close();
}
console.log(`${interrupted ? 'Paused after' : 'Finished'} ${checked} requests with ${failures} response errors.`);
