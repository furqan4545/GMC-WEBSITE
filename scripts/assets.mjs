import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { getPublic, origin } from './source.mjs';

const assetDirectory = new URL('../.migration/assets/', import.meta.url);
const supported = /\.(?:css|js|mjs|avif|webp|jpe?g|png|gif|bmp|svg|ico|woff2?|ttf|otf|eot|mp4|webm|m4v|mov|pdf|json)$/i;
const pending = new Map();
const mirrors = [
  { origin: 'https://cdn.trustindex.io', prefix: '/gmc-media/trustindex', path: /^\/assets\/platform\/Google\/[a-z0-9/_-]+\.svg$/i },
  { origin: 'https://lh3.googleusercontent.com', prefix: '/gmc-media/profile', path: /^\/a-\/[a-z0-9_=-]+$/i },
];

export function assetUrl(value, base = origin) {
  if (!value || value.startsWith('data:') || value.startsWith('#')) return null;
  let url;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (url.origin === origin && /^\/wp-(?:content|includes)\//.test(url.pathname) && supported.test(url.pathname)) return url;
  for (const mirror of mirrors) {
    if (url.origin === origin && url.pathname.startsWith(mirror.prefix + '/')) {
      const path = url.pathname.slice(mirror.prefix.length);
      if (mirror.path.test(path)) return new URL(path + url.search + url.hash, mirror.origin);
    }
    if (url.origin === mirror.origin && mirror.path.test(url.pathname)) return url;
  }
  return null;
}

export function localAsset(value, base = origin) {
  const url = assetUrl(value, base);
  if (!url) return value;
  const prefix = mirrors.find(mirror => mirror.origin === url.origin)?.prefix || '';
  return prefix + url.pathname + url.search + url.hash;
}

export function localSrcset(value) {
  return value?.replace(/(?:https?:)?\/\/(?:gangnammedicalconcierge\.com|cdn\.trustindex\.io|lh3\.googleusercontent\.com)\/[^\s,]+/g, url => localAsset(url));
}

export function localCss(value, base = origin) {
  return value?.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]+))\s*\)/gi, (full, double, single, plain) => {
    const path = (double ?? single ?? plain).trim();
    const local = localAsset(path, base);
    return path === local ? full : `url("${local}")`;
  });
}

export async function downloadAsset(value) {
  const url = assetUrl(value);
  if (!url) return null;
  const requested = localAsset(url.href);
  if (pending.has(requested)) return pending.get(requested);
  const fetch = (async () => {
    const hash = createHash('sha256').update(requested).digest('hex');
    const meta = new URL(hash + '.json', assetDirectory);
    const file = new URL(hash + '.bin', assetDirectory);
    try {
      return { ...JSON.parse(await readFile(meta, 'utf8')), body: await readFile(file), cached: true };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const result = await getPublic(url.href);
    if (result.status === 200 && result.body.length && !result.type.startsWith('text/html')) {
      await mkdir(assetDirectory, { recursive: true });
      await writeFile(file, result.body);
      const temp = new URL(hash + '.tmp', assetDirectory);
      await writeFile(temp, JSON.stringify({ status: result.status, type: result.type, destination: result.destination, requested }));
      await rename(temp, meta);
    }
    return result;
  })();
  pending.set(requested, fetch);
  try {
    return await fetch;
  } finally {
    pending.delete(requested);
  }
}
