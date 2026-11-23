import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { gunzipSync } from 'node:zlib';
import { parseRecords } from './baseline.mjs';
import { assetUrl, downloadAsset, localAsset, localCss } from './assets.mjs';
import { previewHtml } from './preview.mjs';
import { isVerificationPage, origin, sitemapFiles } from './source.mjs';

const snapshot = new URL('../.migration/', import.meta.url);
const site = new URL('../site/', import.meta.url);
const output = fileURLToPath(new URL('../dist/', import.meta.url));
const audit = new URL('../artifacts/', import.meta.url);
const urls = JSON.parse(await readFile(new URL('urls.json', snapshot), 'utf8'));
const linkedRoutes = JSON.parse(await readFile(new URL('public-link-routes.json', snapshot), 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '{}';
  throw error;
}));
const pageResults = parseRecords(await readFile(new URL('crawl.ndjson', snapshot), 'utf8'));
const assets = new Map();
const absentPages = [];
const absentLinkedRoutes = [];
const absentAssets = [];
let pages = 0;
let linkedPages = 0;

function target(path) {
  const destination = resolve(output, '.' + decodeURIComponent(path));
  if (!destination.startsWith(output.endsWith(sep) ? output : output + sep)) {
    throw new Error(`Outside copied directory: ${path}`);
  }
  return destination;
}

async function place(path, contents) {
  const destination = target(path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}

function collect(html, base = origin) {
  // Match first-party media, versioned styles and scripts in HTML, inline CSS and external CSS.
  const normalized = html.replaceAll('&amp;', '&').replaceAll('\\/', '/');
  const pattern = /(?:(?:https?:)?\/\/gangnammedicalconcierge\.com)?\/wp-(?:content|includes)\/[^\s"',()<>]+|https:\/\/(?:cdn\.trustindex\.io|lh3\.googleusercontent\.com)\/[^\s"',()<>]+/gi;
  for (const match of normalized.matchAll(pattern)) {
    const url = assetUrl(match[0], base);
    if (!url) continue;
    const path = new URL(localAsset(url.href), origin).pathname;
    if (!assets.has(path)) assets.set(path, url.href);
  }
}

await Promise.all([mkdir(output, { recursive: true }), mkdir(audit, { recursive: true })]);
for (const path of new Set([...Object.keys(urls), ...Object.keys(linkedRoutes)])) {
  const sitemapPage = Object.hasOwn(urls, path);
  const missing = sitemapPage ? absentPages : absentLinkedRoutes;
  const row = pageResults.get(path);
  if (!row?.file) {
    missing.push({ path, status: row?.status || null });
    continue;
  }
  const raw = gunzipSync(await readFile(new URL('pages/' + row.file, snapshot)));
  if (isVerificationPage(raw)) {
    missing.push({ path, status: row.status, error: 'Source requested visitor verification' });
    await rm(target(new URL(path, origin).pathname.replace(/\/?$/, '/') + 'index.html'), { force: true });
    continue;
  }
  const html = raw.toString();
  collect(html);
  const pathname = new URL(path, origin).pathname;
  await place(pathname.replace(/\/?$/, '/') + 'index.html', previewHtml(html));
  if (sitemapPage) pages++;
  else linkedPages++;
}
for (const name of [...sitemapFiles, 'sitemap.xml', 'wp-sitemap.xml', 'robots.txt', 'main-sitemap.xsl', 'sitemap.xsl']) {
  await copyFile(new URL(name, snapshot), target('/' + name)).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
}
await place('/gmc-preview/site.css', await readFile(new URL('site.css', site)));
await place('/gmc-preview/site.js', await readFile(new URL('site.js', site)));
await place('/gmc-preview/preview-only.js', await readFile(new URL('preview-only.js', import.meta.url)));
for (const file of await readdir(new URL('fonts/', site))) {
  await place('/gmc-preview/fonts/' + file, await readFile(new URL('fonts/' + file, site)));
}

console.log(`Copied ${pages}/${Object.keys(urls).length} sitemap pages and ${linkedPages} additional linked pages. Found ${assets.size} first-party assets.`);
const copyNetworkAssets = process.argv.includes('--assets');
if (!copyNetworkAssets) {
  const inventory = await readdir(new URL('assets/', snapshot), { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const available = new Set();
  for (const item of inventory) {
    if (!item.name.endsWith('.json')) continue;
    const record = JSON.parse(await readFile(new URL('assets/' + item.name, snapshot), 'utf8'));
    const path = new URL(record.requested, origin).pathname;
    if (available.has(path)) continue;
    const raw = await readFile(new URL('assets/' + item.name.replace(/\.json$/, '.bin'), snapshot));
    const body = record.type.startsWith('text/css') ? localCss(raw.toString(), record.destination) : raw;
    await place(path, body);
    available.add(path);
  }
  for (const [path, url] of assets) {
    if (!available.has(path)) absentAssets.push({ url, status: null });
  }
  console.log(`Copied ${available.size} original assets from the local cache.`);
} else {
  const queue = [...assets];
  let next = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < queue.length) {
      const [path, url] = queue[next++];
      let cached = false;
      try {
        const original = await downloadAsset(url);
        cached = original?.cached;
        if (!original || original.status !== 200 || original.type.startsWith('text/html')) {
          absentAssets.push({ url, status: original?.status || null });
        } else {
          const css = original.type.startsWith('text/css');
          const countBefore = assets.size;
          if (css) collect(original.body.toString(), url);
          if (assets.size > countBefore) queue.push(...[...assets].slice(countBefore));
          await place(path, css ? localCss(original.body.toString(), url) : original.body);
        }
      } catch (error) {
        absentAssets.push({ url, error: error.message });
      }
      if (++completed % 100 === 0) console.log(`Processed ${completed}/${queue.length} asset URLs.`);
      if (!cached) await delay(220);
    }
  }));
}
const summary = { pages, absentPages, linkedPages, absentLinkedRoutes, assetUrls: assets.size, absentAssets };
await writeFile(new URL('copy-audit.json', audit), JSON.stringify(summary, null, 2) + '\n');
console.log(`${absentPages.length + absentLinkedRoutes.length} pages and ${absentAssets.length} assets are still missing from the offline build.`);
