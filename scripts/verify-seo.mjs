import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { load } from 'cheerio';
import { previewHtml } from './preview.mjs';
import { isVerificationPage, isVerificationTitle, origin } from './source.mjs';
import { parseRecords } from './baseline.mjs';
import { localAsset, localSrcset } from './assets.mjs';

const baseline = new URL('../.migration/', import.meta.url);
const output = new URL('../artifacts/', import.meta.url);
const pathname = new URL('urls.json', baseline);
const urlMap = JSON.parse(await readFile(pathname, 'utf8'));
const log = await readFile(new URL('crawl.ndjson', baseline), 'utf8');
const records = parseRecords(log);

const preservedHead = [
  'head title',
  'head meta[name=description]',
  'head meta[name=robots]',
  'head meta[property^="og:"]',
  'head meta[name^="twitter:"]',
  'head link[rel=canonical]',
  'head link[hreflang]',
  'script[type="application/ld+json"]',
].join(', ');
const preservedMedia = 'main img, main source, main video, [data-elementor-type="single-post"] img, [data-elementor-type="single-post"] source';
const supportedTemplate = 'main.site-main, .elementor-location-single, .elementor-location-archive, main';
const headerRequirements = ['header.elementor-location-header', 'header .jet-mega-menu-list', 'header img.wp-image-18', 'header .elementor-element-175b3f98 a[href]'];

function links($) {
  return $('main a[href], .elementor-location-single a[href], .elementor-location-archive a[href]')
    .map((_, node) => new URL($(node).attr('href'), origin).href).get();
}

function media($) {
  return $(preservedMedia).map((_, node) =>
    JSON.stringify(['src', 'data-src', 'srcset', 'data-srcset', 'poster', 'alt'].map(attr => {
      const value = $(node).attr(attr) || '';
      if (attr === 'alt') return value;
      return attr.includes('srcset') ? localSrcset(value) : localAsset(value);
    })),
  ).get();
}

const summary = {
  sitemapUrls: Object.keys(urlMap).length,
  sitemapCounts: Object.values(urlMap).reduce((result, file) => {
    result[file] = (result[file] || 0) + 1;
    return result;
  }, {}),
  responsesExamined: 0,
  matching: 0,
  existingRedirects: [],
  existingCanonicalDifferences: [],
  unsupportedMarkup: [],
  unavailable: [],
  pending: [],
  differences: [],
};
const list = ['Path\tSitemap\tUpstream status\tFinal URL\tCanonical\tLanguage\tTitle'];
for (const [path, sitemap] of Object.entries(urlMap)) {
  const row = records.get(path);
  list.push([path, sitemap, row?.status || '', row?.destination || '', row?.canonical || '', row?.lang || '', row?.title || ''].join('\t').replace(/[\r\n]/g, ' '));
  if (!row) {
    summary.pending.push(path);
    continue;
  }
  summary.responsesExamined++;
  if (!row.file || isVerificationTitle(row.title)) {
    summary.unavailable.push({ path, status: row.status, error: row.error || 'Source requested visitor verification' });
    continue;
  }
  if (row.destination !== origin + path) summary.existingRedirects.push({ path, to: row.destination });
  if (row.canonical !== row.destination) summary.existingCanonicalDifferences.push({ path, canonical: row.canonical });
  try {
    const raw = gunzipSync(await readFile(new URL(`pages/${row.file}`, baseline)));
    assert.ok(!isVerificationPage(raw), 'Source verification response');
    const html = raw.toString();
    const original = load(html);
    const rebuilt = load(previewHtml(html));
    assert.equal(rebuilt(preservedHead).toString(), original(preservedHead).toString(), 'Search and social metadata');
    assert.deepEqual(links(rebuilt), links(original), 'Content links');
    assert.deepEqual(media(rebuilt), media(original), 'Content media');
    assert.equal(rebuilt('html').attr('lang'), original('html').attr('lang'), 'Document language');
    assert.deepEqual(
      rebuilt('form').map((_, node) => [rebuilt(node).attr('method'), rebuilt(node).attr('action')].join('|')).get(),
      original('form').map((_, node) => [original(node).attr('method'), original(node).attr('action')].join('|')).get(),
      'Form endpoints',
    );
    if (!original(supportedTemplate).length || headerRequirements.some(selector => !original(selector).length)) {
      summary.unsupportedMarkup.push(path);
    }
    summary.matching++;
  } catch (error) {
    summary.differences.push({ path, reason: error.message.slice(0, 250) });
  }
}

await mkdir(output, { recursive: true });
await writeFile(new URL('migration-audit.json', output), JSON.stringify(summary, null, 2) + '\n');
await writeFile(new URL('url-inventory.tsv', output), list.join('\n') + '\n');
console.log(JSON.stringify({
  sitemapUrls: summary.sitemapUrls,
  matching: summary.matching,
  pending: summary.pending.length,
  unavailable: summary.unavailable.length,
  unsupported: summary.unsupportedMarkup.length,
  differences: summary.differences.length,
  upstreamRedirects: summary.existingRedirects.length,
  upstreamCanonicalDifferences: summary.existingCanonicalDifferences.length,
}, null, 2));
if (summary.pending.length || summary.differences.length || summary.unavailable.length || summary.unsupportedMarkup.length) process.exitCode = 1;
