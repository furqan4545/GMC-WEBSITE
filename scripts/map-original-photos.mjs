import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import { origin } from './source.mjs';

const uploads = new URL('../dist/wp-content/uploads/', import.meta.url);
const output = new URL('../site/photo-originals.json', import.meta.url);
const root = fileURLToPath(uploads);
const photos = (await readdir(uploads, { recursive: true, withFileTypes: true }))
  .filter(file => file.isFile() && /\.(?:avif|gif|jpe?g|png|webp)$/i.test(file.name))
  .map(file => '/wp-content/uploads/' + relative(root, resolve(file.parentPath, file.name)));
const byPath = new Set(photos);
const byName = new Map();
for (const photo of photos) {
  if (photo.includes('/elementor/thumbs/')) continue;
  const name = basename(photo);
  const entries = byName.get(name) || [];
  entries.push(photo);
  byName.set(name, entries);
}

const matches = new Map();
const ambiguous = new Map();
for (const photo of photos.sort()) {
  const name = basename(photo);
  const extension = extname(name);
  const stem = basename(name, extension);
  const regional = stem.match(/^(.*)-\d+x\d+$/);
  const elementor = stem.match(/^(.*)-[a-z0-9]{32,}$/);
  let original;
  if (photo.includes('/elementor/thumbs/') && elementor) {
    const candidates = byName.get(elementor[1] + extension);
    if (candidates?.length === 1) original = candidates[0];
    if (candidates?.length > 1) ambiguous.set(photo, candidates);
  } else if (regional) {
    const path = dirname(photo) + '/' + regional[1];
    original = [path + extension, path + '-scaled' + extension].find(candidate => byPath.has(candidate));
  }
  if (original) matches.set(photo, original);
}

const dist = new URL('../dist/', import.meta.url);
const confirmed = new Map();
const articleImages = new Map();
for (const page of (await readdir(dist, { recursive: true })).filter(path => /(^|\/)index\.html$/.test(path))) {
  const html = await readFile(new URL(page.split('/').map(encodeURIComponent).join('/'), dist), 'utf8');
  if (![...ambiguous.keys()].some(photo => html.includes(photo))) continue;
  const $ = load(html);
  for (const node of $('img[data-lazy-src], img[src]')) {
    const photo = $(node).attr('data-lazy-src') || $(node).attr('src');
    if (!ambiguous.has(photo)) continue;
    const href = $(node).closest('a[href]').attr('href') || $(node).closest('.elementor-widget-image-box').find('a[href]').first().attr('href');
    if (!href?.startsWith('/') || href.startsWith('//')) continue;
    const path = new URL(href, origin).pathname.replace(/\/?$/, '/');
    if (!articleImages.has(path)) {
      const article = await readFile(new URL(path.slice(1) + 'index.html', dist), 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return '';
      });
      const src = load(article)('meta[property="og:image"]').attr('content');
      articleImages.set(path, src ? decodeURIComponent(new URL(src, origin).pathname) : null);
    }
    const image = articleImages.get(path);
    if (ambiguous.get(photo).includes(image)) {
      if (!confirmed.has(photo)) confirmed.set(photo, new Set());
      confirmed.get(photo).add(image);
    }
  }
}
for (const [photo, originals] of confirmed) {
  if (originals.size === 1) matches.set(photo, [...originals][0]);
}

await writeFile(output, JSON.stringify(Object.fromEntries(matches), null, 2) + '\n');
console.log(`${matches.size} derivative images matched to their full original in the local asset library.`);
