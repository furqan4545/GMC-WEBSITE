import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { load } from 'cheerio';
import { isVerificationPage, isVerificationTitle } from './source.mjs';

export const baseline = new URL('../.migration/', import.meta.url);
const cache = new URL('pages/', baseline);
const ledger = new URL('crawl.ndjson', baseline);
function fileFor(path) {
  return createHash('sha256').update(path).digest('hex') + '.html.gz';
}

export async function cachedPage(path) {
  const body = await readFile(new URL(fileFor(path), cache)).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (!body) return null;
  const original = gunzipSync(body);
  return isVerificationPage(original) ? null : original.toString();
}

export function parseRecords(log) {
  const rows = new Map();
  const lines = log.split('\n');
  // The final slot is empty, or still being appended by a worker.
  lines.pop();
  for (const line of lines.filter(Boolean)) {
    const row = JSON.parse(line);
    if (row.error?.includes('Target page, context or browser has been closed')) continue;
    const old = rows.get(row.path);
    if (row.file || !old?.file || isVerificationTitle(old.title)) rows.set(row.path, row);
  }
  return rows;
}

function fields(body) {
  const $ = load(body.toString());
  const alternates = $('link[rel=alternate][hreflang]').toArray().map(node => ({
    lang: $(node).attr('hreflang'),
    href: $(node).attr('href'),
  }));
  return {
    lang: $('html').attr('lang'),
    title: $('head title').text(),
    canonical: $('link[rel=canonical]').attr('href') ?? null,
    description: $('meta[name=description]').attr('content') ?? null,
    robots: $('meta[name=robots]').attr('content') ?? null,
    alternates,
    schemaCount: $('script[type="application/ld+json"]').length,
    headings: $('main h1, main h2').length,
    images: $('main img').length,
    forms: $('main form').length,
  };
}

export async function recordPage(path, response, sitemap, error) {
  const row = { path, sitemap, status: response?.status || 0, destination: response?.destination };
  if (error) {
    row.error = error;
  } else if (isVerificationPage(response.body)) {
    row.error = 'Source returned a verification page instead of GMC content';
  } else if (response.status === 200 && response.type?.startsWith('text/html')) {
    const file = fileFor(path);
    await mkdir(cache, { recursive: true });
    const temporary = new URL(randomUUID() + '.tmp', cache);
    await writeFile(temporary, gzipSync(response.body));
    await rename(temporary, new URL(file, cache));
    Object.assign(row, fields(response.body), { file });
  }
  await appendFile(ledger, JSON.stringify(row) + '\n');
  return row;
}
