import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { gunzipSync } from 'node:zlib';
import { load } from 'cheerio';
import { downloadAsset } from './assets.mjs';
import { origin } from './source.mjs';

const root = new URL('../', import.meta.url);
const dist = fileURLToPath(new URL('dist/', root));
const output = resolve(dist, 'gmc-preview/collections');
const media = resolve(dist, 'wp-content/uploads');
const snapshot = new URL('.migration/', root);
const languages = ['en', 'zh', 'tw', 'id', 'ru', 'th'];
const fetchPublicImages = process.argv.includes('--assets');
const inventory = load(await readFile(new URL('private/wordpress-content.xml', snapshot), 'utf8'), { xml: true });
const archive = new Map(languages.map(language => [language, new Map()]));
const posts = new Map();
const galleryCategories = new Map();
const terms = new Map();

for (const term of inventory('channel > wp\\:category').toArray()) {
  const record = inventory(term);
  const slug = record.children('wp\\:category_nicename').text();
  terms.set(slug, { id: record.children('wp\\:term_id').text(), parent: record.children('wp\\:category_parent').text() });
}

for (const entry of inventory('channel > item').toArray()) {
  const record = inventory(entry);
  if (record.children('wp\\:status').text() !== 'publish') continue;
  const id = record.children('wp\\:post_id').text();
  const type = record.children('wp\\:post_type').text();
  if (type !== 'post' && type !== 'bna') continue;
  const categories = new Set(record.children('category[domain="category"]').map((_, category) => inventory(category).attr('nicename')).get());
  for (const category of categories) {
    const parent = terms.get(category)?.parent;
    if (parent) categories.add(parent);
  }
  if (type === 'bna') galleryCategories.set(id, [...categories].map(slug => terms.get(slug)?.id).filter(Boolean));
  else posts.set(id, [...categories]);
}

function publicImage(value) {
  if (!value) return;
  const url = new URL(value, origin);
  const prefix = '/wp-content/uploads/';
  if (url.origin !== origin || !url.pathname.startsWith(prefix) || !/\.(?:avif|gif|jpe?g|png|webp)$/i.test(url.pathname)) return;
  const target = resolve(media, decodeURIComponent(url.pathname.slice(prefix.length)));
  if (target.startsWith(media + sep)) return { url, target };
}

async function savePublicImage(image) {
  if (existsSync(image.target)) return true;
  const key = createHash('sha256').update(image.url.href).digest('hex');
  const backup = new URL(`private/media/${key}.bin`, snapshot);
  if (existsSync(backup)) {
    await mkdir(dirname(image.target), { recursive: true });
    await copyFile(backup, image.target);
    return true;
  }
  if (!fetchPublicImages) return false;
  try {
    const response = await downloadAsset(image.url.href);
    if (response.status !== 200 || !response.type.startsWith('image/')) return false;
    await mkdir(dirname(image.target), { recursive: true });
    await writeFile(image.target, response.body);
    return true;
  } catch (error) {
    console.error(`Could not fetch a public gallery image (${error.name}).`);
    return false;
  } finally {
    await delay(450);
  }
}

const pagePaths = (await readdir(dist, { recursive: true })).filter(name => /(^|\/)index\.html$/.test(name));
for (let offset = 0; offset < pagePaths.length; offset += 24) {
  await Promise.all(pagePaths.slice(offset, offset + 24).map(async path => {
    const html = await readFile(resolve(dist, path), 'utf8');
    const bodyClass = /<body\b[^>]*\bclass="([^"]+)"/i.exec(html)?.[1] || '';
    if (!/(?:^|\s)single-post(?:\s|$)/.test(bodyClass)) return;
    const id = /\bpostid-(\d+)\b/.exec(bodyClass)?.[1];
    if (!id || !posts.has(id)) return;
    const route = '/' + path.slice(0, -'index.html'.length).split('/').map(encodeURIComponent).join('/');
    const locale = route.split('/')[1];
    const language = languages.includes(locale) ? locale : 'en';
    const $ = load(html);
    const title = $('.elementor-widget-theme-post-title h1, .elementor-widget-theme-post-title h2, main h1').first().text().trim()
      || $('meta[property="og:title"]').attr('content')?.trim();
    if (!title) return;
    const image = publicImage($('meta[property="og:image"]').attr('content'));
    archive.get(language).set(id, {
      id,
      route,
      title,
      categories: posts.get(id),
      date: $('meta[property="article:published_time"]').attr('content') || '',
      image: image && existsSync(image.target) ? image.url.pathname : undefined,
    });
  }));
}

const gallery = new Map();
const visibleGallery = new Set();
const missingPages = [];
const missingImages = new Set();
const firstGallery = await readFile(resolve(dist, 'bna-gallery/index.html'), 'utf8');
const expectedPages = Number(load(firstGallery)('#list-2 .jet-listing-grid__items').attr('data-pages'));
for (let page = 1; page <= expectedPages; page++) {
  const cached = page === 1 ? firstGallery : await readFile(new URL(`collections/gallery-${page}.html.gz`, snapshot)).catch(() => null);
  if (!cached) {
    missingPages.push(page);
    continue;
  }
  const $ = load(page === 1 ? cached : gunzipSync(cached));
  for (const card of $('#list-2 .jet-listing-grid__items > [data-post-id]').toArray()) {
    const id = $(card).attr('data-post-id');
    if (!galleryCategories.has(id) || gallery.has(id)) continue;
    visibleGallery.add(id);
    const figure = $(card).find('img').first();
    const image = publicImage(figure.attr('data-lazy-src') || figure.attr('data-src') || figure.attr('src'));
    if (!image) continue;
    if (!await savePublicImage(image)) {
      missingImages.add(image.url.pathname);
      continue;
    }
    gallery.set(id, {
      image: image.url.pathname,
      alt: figure.attr('alt') || '',
      width: Number(figure.attr('width')) || undefined,
      height: Number(figure.attr('height')) || undefined,
      categories: galleryCategories.get(id),
    });
  }
}

await mkdir(output, { recursive: true });
for (const [language, records] of archive) {
  const entries = [...records.values()].sort((left, right) => right.date.localeCompare(left.date) || Number(right.id) - Number(left.id));
  await writeFile(resolve(output, `${language}.json`), JSON.stringify(entries));
}
await writeFile(resolve(output, 'gallery.json'), JSON.stringify([...gallery.values()]));
for (const extension of ['js', 'css']) {
  const file = `static-collections.${extension}`;
  await copyFile(new URL('site/' + file, root), resolve(output, '..', file));
}

const audit = {
  archivePosts: Object.fromEntries([...archive].map(([locale, index]) => [locale, index.size])),
  gallery: { included: gallery.size, visible: visibleGallery.size, published: galleryCategories.size, missingPages, missingImages: missingImages.size },
};
await writeFile(new URL('artifacts/static-collections-audit.json', root), JSON.stringify(audit, null, 2) + '\n');
console.log(JSON.stringify(audit, null, 2));
