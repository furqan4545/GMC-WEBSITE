import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { load } from 'cheerio';
import { getPublic, isVerificationPage, origin } from './source.mjs';

const cache = new URL('../.migration/collections/', import.meta.url);
const first = new URL('../dist/bna-gallery/index.html', import.meta.url);
const galleryRoute = '/bna-gallery/';
const firstPage = load(await readFile(first, 'utf8'));
const pageCount = Number(firstPage('#list-2 .jet-listing-grid__items').attr('data-pages'));

if (!Number.isInteger(pageCount) || pageCount < 2) {
  throw new Error('The public gallery page does not contain usable pagination.');
}

await mkdir(cache, { recursive: true });
let failures = 0;

for (let page = 2; page <= pageCount; page++) {
  const filename = new URL(`gallery-${page}.html.gz`, cache);
  if (await readFile(filename).catch(() => null)) continue;
  const query = new URLSearchParams({ jsf: 'jet-engine:list-2', pagenum: String(page) });
  try {
    const response = await getPublic(`${galleryRoute}?${query}`);
    const destination = new URL(response.destination);
    if (response.status !== 200 || destination.origin !== origin || destination.pathname !== galleryRoute || isVerificationPage(response.body)) {
      throw new Error(`Unexpected public response (${response.status})`);
    }
    const $ = load(response.body);
    const grid = $('#list-2 .jet-listing-grid__items');
    if (Number(grid.attr('data-page')) !== page || !grid.children('[data-post-id]').length) {
      throw new Error('The returned gallery did not contain this page of entries');
    }
    await writeFile(filename, gzipSync(response.body));
    console.log(`Saved public gallery page ${page}/${pageCount}.`);
  } catch (error) {
    console.error(`Gallery page ${page}: ${error.message}`);
    failures++;
  }
  await delay(450);
}

if (failures) process.exitCode = 1;
