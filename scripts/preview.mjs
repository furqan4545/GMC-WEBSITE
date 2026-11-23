import { statSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import { getPublic, isVerificationPage, origin } from './source.mjs';
import { assetUrl, downloadAsset, localAsset, localCss, localSrcset } from './assets.mjs';
import { cachedPage, recordPage } from './baseline.mjs';
import photoOriginals from '../site/photo-originals.json' with { type: 'json' };

const site = new URL('../', import.meta.url);
const snapshot = new URL('.migration/', site);
const assets = new URL('site/', site);
const previewFiles = new Map([['/gmc-preview/site.css', 'text/css'], ['/gmc-preview/site.js', 'text/javascript'], ['/gmc-preview/preview-only.js', 'text/javascript']]);
const knownSourceFiles = /^\/(?:robots\.txt|(?:[a-z_-]+-)?sitemap(?:_index)?\.(?:xml|xsl))$/;
const pagePath = /^\/[\p{L}\p{N}\s_%./-]*$/u;
const productionTracker = /googletagmanager|google-analytics|facebook\.net|doubleclick|clarity\.ms|googlesyndication|gtag\s*\(|GTM-[A-Z0-9]+|connect\.facebook|fbq\s*\(/i;

export function previewHtml(source) {
  const $ = load(source);
  $('script').each((_, node) => {
    const script = $(node);
    const src = script.attr('src') || script.attr('data-rocket-src');
    if (productionTracker.test(src || script.text()) || script.text().includes('class RocketLazyLoadScripts')) {
      script.remove();
      return;
    }
    if (['elementor-frontend-js-before', 'elementor-pro-frontend-js-before'].includes(script.attr('id'))) {
      const assetBase = /https?:\\?\/\\?\/gangnammedicalconcierge\.com(?=\\?\/wp-content\\?\/plugins\\?\/elementor(?:-pro)?\\?\/assets\\?\/)/g;
      script.text(script.text().replace(assetBase, ''));
    }
    if (script.attr('type') !== 'text/rocketlazyloadscript') return;
    const type = script.attr('data-rocket-type');
    if (src) script.attr('src', src);
    script.removeAttr('type data-rocket-src data-rocket-type data-rocket-defer defer async');
    if (type) script.attr('type', type);
  });
  $('iframe').each((_, node) => {
    if (productionTracker.test($(node).attr('src') || $(node).attr('data-src') || '')) $(node).remove();
  });
  $('a[href]').each((_, node) => {
    const href = $(node).attr('href');
    if (!/^https?:\/\/|^\/\//i.test(href)) return;
    let url;
    try {
      url = new URL(href, origin);
    } catch {
      return;
    }
    if (url.origin !== origin || url.pathname.startsWith('/wp-') || /\.[a-z0-9]{2,5}$/i.test(url.pathname)) return;
    $(node).attr('href', url.href.slice(url.origin.length));
  });
  $('img, source, video, audio, track, link[rel="stylesheet"], link[rel="preload"], script[src], script[data-rocket-src]').each((_, node) => {
    const element = $(node);
    for (const attribute of ['src', 'href', 'poster', 'data-src', 'data-lazy-src', 'data-rocket-src']) {
      const value = element.attr(attribute);
      if (value) element.attr(attribute, localAsset(value));
    }
    for (const attribute of ['srcset', 'data-srcset', 'data-lazy-srcset']) {
      const value = element.attr(attribute);
      if (value) element.attr(attribute, localSrcset(value));
    }
    if (node.name === 'img' && !element.closest('picture').length) {
      const source = element.attr('data-lazy-src') || element.attr('data-src') || element.attr('src');
      const url = assetUrl(source);
      if (url && url.origin === origin) {
        const path = url.pathname.replace(/(?:%[0-9a-f]{2})+/gi, encoded => {
          try { return decodeURIComponent(encoded); } catch { return encoded; }
        });
        const full = photoOriginals[path];
        if (full) element.attr('data-gmc-original-photo', full);
      }
    }
  });
  $('style, [style]').each((_, node) => {
    const element = $(node);
    if (element.is('style')) element.text(localCss(element.html()));
    else element.attr('style', localCss(element.attr('style')));
  });
  const cssVersion = Math.trunc(statSync(new URL('site.css', assets)).mtimeMs);
  const jsVersion = Math.trunc(statSync(new URL('site.js', assets)).mtimeMs);
  $('head').append(`<link rel="stylesheet" href="/gmc-preview/site.css?v=${cssVersion}">`);
  $('body').append(`<script src="/gmc-preview/site.js?v=${jsVersion}"></script><script src="/gmc-preview/preview-only.js"></script>`);
  return $.html();
}

function unavailable(path) {
  const href = new URL(path, origin).href.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  return `<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Page unavailable in the local copy</title><style>body{background:#faf7f2;color:#24201f;font:1rem/1.6 system-ui,sans-serif;padding:clamp(1.25rem,8vw,5rem);max-width:42rem}h1{font:2.6rem/1.1 Georgia,serif}a{color:#17483b}</style><main><h1>Page unavailable in the local copy</h1><p>The source site did not return this page. <a href="${href}">Open the original page</a> or reload to try again.</p></main></html>`;
}

const server = createServer(async (request, response) => {
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  response.setHeader('Content-Security-Policy', "form-action 'self'; connect-src 'self'; base-uri 'self'");
  const send = (status, type, body) => {
    response.writeHead(status, { 'Content-Type': type });
    response.end(request.method === 'HEAD' ? undefined : body);
  };
  if (!['GET', 'HEAD'].includes(request.method)) return send(405, 'text/plain', 'This local preview does not submit requests.');
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.origin !== 'http://127.0.0.1') return send(400, 'text/plain', 'Invalid URL');
    const path = url.pathname;
    if (/^\/gmc-preview\/fonts\/[a-z0-9-]+\.woff2$/.test(path)) {
      return send(200, 'font/woff2', await readFile(new URL(path.split('/').slice(-2).join('/'), assets)));
    }
    const type = previewFiles.get(path);
    if (type) {
      const base = path.endsWith('/preview-only.js') ? new URL('scripts/', site) : assets;
      return send(200, type, await readFile(new URL(path.split('/').at(-1), base)));
    }
    const asset = assetUrl(path + url.search);
    if (asset) {
      const resource = await downloadAsset(asset.href);
      if (resource.status !== 200 || resource.type.startsWith('text/html')) {
        return send(404, 'text/plain', 'Original asset unavailable.');
      }
      const body = resource.type.startsWith('text/css') ? localCss(resource.body.toString(), asset.href) : resource.body;
      return send(200, resource.type, body);
    }
    if (knownSourceFiles.test(path)) return send(200, path.endsWith('.txt') ? 'text/plain' : 'application/xml', await readFile(new URL(path.slice(1), snapshot)));
    if (!pagePath.test(path) || path.startsWith('/wp-admin') || path.startsWith('/wp-json') || path.startsWith('/wp-login')) {
      return send(404, 'text/plain', 'This URL is outside the read-only preview.');
    }

    const cache = await cachedPage(path + url.search);
    if (cache && !isVerificationPage(Buffer.from(cache))) return send(200, 'text/html; charset=utf-8', previewHtml(cache));

    const original = await getPublic(path + url.search);
    if (isVerificationPage(original.body)) return send(503, 'text/html; charset=utf-8', unavailable(path + url.search));
    if (!original.type?.startsWith('text/html')) return send(original.status, original.type || 'application/octet-stream', original.body);
    const destination = new URL(original.destination);
    if (destination.origin === origin && destination.pathname !== path && original.status === 200) {
      response.writeHead(302, { Location: destination.pathname + destination.search });
      return response.end();
    }
    if (original.status === 200) {
      const inventory = await readFile(new URL('urls.json', snapshot), 'utf8').catch(() => '{}');
      const sitemap = JSON.parse(inventory)[path + url.search];
      await recordPage(path + url.search, original, sitemap);
    }
    return send(original.status, 'text/html; charset=utf-8', previewHtml(original.body.toString()));
  } catch (error) {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (assetUrl(path)) send(404, 'text/plain', 'Original asset unavailable.');
    else send(503, 'text/html; charset=utf-8', unavailable(path));
    console.error(error.message);
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) server.listen(Number(process.env.GMC_PREVIEW_PORT || 4177), '127.0.0.1', () => {
  console.log(`GMC read-only preview at http://127.0.0.1:${server.address().port}/`);
});
