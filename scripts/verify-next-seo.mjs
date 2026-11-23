import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { load } from 'cheerio';

const snapshot = new URL('../content/', import.meta.url);
const built = new URL('../.next/server/pages/', import.meta.url);
const { pages } = JSON.parse(await readFile(new URL('manifest.json', snapshot), 'utf8'));
const builtFiles = new Set(await readdir(built, { recursive: true }));
const selectors = [
  'title',
  'meta[name="description"]',
  'meta[name="robots"]',
  'meta[property^="og:"]',
  'meta[name^="twitter:"]',
  'link[rel="canonical"]',
  'link[hreflang]',
  'script[type="application/ld+json"]',
];

function metadata($, selector) {
  return $('head').find(selector).toArray().map(node => {
    const attributes = Object.entries(node.attribs)
      .filter(([name]) => name !== 'data-next-head')
      .sort(([left], [right]) => left.localeCompare(right));
    return JSON.stringify([attributes, $(node).text()]);
  }).sort();
}

const errors = [];
for (const [path, file] of Object.entries(pages)) {
  const pageFile = (path.slice(1).replace(/\/$/, '') || 'index') + '.html';
  const builtFile = [pageFile, decodeURIComponent(pageFile)].find(item => builtFiles.has(item));
  if (!builtFile) {
    errors.push({ path, difference: 'Missing compiled page' });
    continue;
  }

  const [$source, $rendered] = await Promise.all([
    readFile(new URL('pages/' + file, snapshot)).then(body => load(gunzipSync(body).toString('utf8'))),
    readFile(new URL(builtFile.split('/').map(encodeURIComponent).join('/'), built), 'utf8').then(html => load(html)),
  ]);

  for (const [selector, attribute] of [['html', 'lang'], ['body', 'class']]) {
    if ($rendered(selector).attr(attribute) !== $source(selector).attr(attribute)) {
      errors.push({ path, difference: `${selector}[${attribute}]` });
    }
  }
  for (const selector of selectors) {
    try {
      assert.deepEqual(metadata($rendered, selector), metadata($source, selector));
    } catch {
      errors.push({ path, difference: selector });
    }
  }
}

const total = Object.keys(pages).length;
console.log(`Compared search metadata and document attributes for ${total} compiled pages.`);
if (errors.length) {
  console.error(`${errors.length} differences across ${new Set(errors.map(({ path }) => path)).size} routes.`);
  console.error(JSON.stringify(errors.slice(0, 30), null, 2));
  process.exitCode = 1;
} else {
  console.log('All compiled pages match the prepared snapshot.');
}
