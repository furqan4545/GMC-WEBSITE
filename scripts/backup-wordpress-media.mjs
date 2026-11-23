import { constants, createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { load } from 'cheerio';
import { isVerificationPage, origin } from './source.mjs';

process.umask(0o077);

const cache = new URL('../.migration/assets/', import.meta.url);
const backup = new URL('../.migration/private/', import.meta.url);
const originals = new URL('media/', backup);
const exportFile = new URL('wordpress-content.xml', backup);

function uploadUrl(value) {
  const url = new URL(value, origin);
  if (url.origin !== origin || url.username || url.password || url.search || url.hash ||
      !url.pathname.startsWith('/wp-content/uploads/')) {
    throw new Error('WordPress attachment is outside the expected uploads directory.');
  }
  return url;
}

async function assetsInCache() {
  const names = await readdir(cache).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const files = new Map();
  for (const name of names.filter(name => name.endsWith('.json'))) {
    const metadata = JSON.parse(await readFile(new URL(name, cache), 'utf8'));
    const url = new URL(metadata.requested, origin);
    if (url.origin === origin && !url.search && !url.hash && url.pathname.startsWith('/wp-content/uploads/')) {
      files.set(url.href, new URL(name.replace(/\.json$/, '.bin'), cache));
    }
  }
  return files;
}

function wordpressMedia(xml) {
  const files = new Map();
  for (const node of xml('item').toArray()) {
    const item = xml(node);
    const attachment = item.children('wp\\:attachment_url').text().trim();
    if (!attachment) continue;
    const url = uploadUrl(attachment);
    files.set(url.href, 'attachment');

    for (const field of item.children('wp\\:postmeta').toArray()) {
      const key = xml(field).children('wp\\:meta_key').text().trim();
      if (key !== '_wp_attachment_metadata') continue;
      const metadata = xml(field).children('wp\\:meta_value').text();
      const original = /s:14:"original_image";s:(\d+):"([^"]+)";/.exec(metadata);
      if (!original) continue;
      const [, bytes, filename] = original;
      if (Buffer.byteLength(filename) !== Number(bytes) || /[\/\\]/.test(filename) || filename === '.' || filename === '..') {
        throw new Error('WordPress exported an invalid original image filename.');
      }
      const originalUrl = uploadUrl(new URL(encodeURIComponent(filename), url));
      if (!files.has(originalUrl.href)) files.set(originalUrl.href, 'full-size original');
    }
  }
  return files;
}

let retryAfter = 0;

async function download(url, file) {
  let destination = url;
  const signal = AbortSignal.timeout(30_000);
  for (let redirects = 0; redirects < 5; redirects++) {
    const response = await fetch(destination, { redirect: 'manual', signal });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      destination = uploadUrl(new URL(location, destination));
      continue;
    }

    const status = response.status;
    const type = response.headers.get('content-type')?.split(';')[0] || '';
    const html = type === 'text/html';
    const htmlAttachment = /\.html?$/i.test(url.pathname);
    const blocked = response.headers.get('cf-mitigated') === 'challenge';
    if (status !== 200 || blocked || (html && !htmlAttachment) || !response.body) {
      if (status === 429) {
        const after = response.headers.get('retry-after');
        const requestedTime = Number(after) ? Date.now() + Number(after) * 1000 : Date.parse(after);
        retryAfter = Math.max(retryAfter, requestedTime || Date.now() + 5000);
      }
      await response.body?.cancel();
      return { status, saved: false, ...(blocked ? { error: 'Visitor verification required' } : {}) };
    }

    await pipeline(Readable.fromWeb(response.body), createWriteStream(file, { flags: 'wx', mode: 0o600 }));
    if (html) {
      const handle = await open(file, 'r');
      try {
        const head = Buffer.alloc(4096);
        const { bytesRead } = await handle.read(head);
        if (isVerificationPage(head.subarray(0, bytesRead))) {
          return { status, saved: false, error: 'Visitor verification required' };
        }
      } finally {
        await handle.close();
      }
    }
    const { size } = await stat(file);
    return { status, type, bytes: size, saved: size > 0, source: 'download' };
  }
  return { status: null, saved: false, error: 'Too many redirects' };
}

const xml = load(await readFile(exportFile, 'utf8'), { xml: true });
const originalsOnly = process.argv.includes('--originals-only');
const files = [...wordpressMedia(xml)].filter(([, type]) => !originalsOnly || type === 'full-size original');
if (!files.length) throw new Error('No matching media found in the WordPress export.');
const known = await assetsInCache();
await mkdir(originals, { mode: 0o700, recursive: true });

const records = new Array(files.length);
let cursor = 0;
let completed = 0;
console.log(`Backing up ${files.length} WordPress media URLs. ${files.filter(([url]) => known.has(url)).length} match the existing asset cache.`);

async function processAttachment(url) {
  const key = createHash('sha256').update(url.href).digest('hex');
  const name = `${key}.bin`;
  const file = new URL(name, originals);
  const existing = await stat(file).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing?.size) return { file: name, bytes: existing.size, saved: true, source: 'backup' };

  const temporary = new URL(`${key}-${randomUUID()}.tmp`, originals);
  try {
    const cached = known.get(url.href);
    let record;
    if (cached) {
      await copyFile(cached, temporary, constants.COPYFILE_FICLONE);
      await chmod(temporary, 0o600);
      const { size } = await stat(temporary);
      record = { bytes: size, saved: size > 0, source: 'asset cache' };
    } else {
      if (retryAfter > Date.now()) await delay(retryAfter - Date.now());
      try {
        record = await download(url, temporary);
      } finally {
        await delay(450);
      }
    }
    if (!record.saved) return record;
    await rename(temporary, file);
    return { ...record, file: name };
  } finally {
    await rm(temporary, { force: true });
  }
}

async function worker() {
  while (cursor < files.length) {
    const index = cursor++;
    const [url, kind] = files[index];
    let result;
    try {
      result = await processAttachment(uploadUrl(url));
    } catch (error) {
      result = { saved: false, error: error.cause?.code || error.code || error.name };
    }
    records[index] = { url, kind, ...result };
    if (++completed % 100 === 0) console.log(`Checked ${completed}/${files.length} media files.`);
  }
}

await Promise.all(originalsOnly ? [worker()] : [worker(), worker()]);
const inventory = new URL(originalsOnly ? 'media-originals-inventory.json' : 'media-inventory.json', backup);
const temporaryInventory = new URL(`${randomUUID()}.tmp`, backup);
await writeFile(temporaryInventory, JSON.stringify(records, null, 2) + '\n', { mode: 0o600 });
await rename(temporaryInventory, inventory);
const counts = records.reduce((summary, record) => {
  const result = record.saved ? record.source : String(record.status || record.error || 'unavailable');
  summary[result] = (summary[result] || 0) + 1;
  return summary;
}, {});
console.log(JSON.stringify({ media: records.length, saved: records.filter(record => record.saved).length, counts }, null, 2));
if (records.some(record => !record.saved)) process.exitCode = 1;
