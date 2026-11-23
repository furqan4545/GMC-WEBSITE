import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { load } from 'cheerio';
import { origin } from './source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = resolve(root, 'dist');

const assetPath = /^(?:wp-content\/(?:cache|min|plugins|themes|uploads)\/|wp-includes\/|gmc-preview\/)/;
const assetExtension = /\.(?:css|js|mjs|avif|webp|jpe?g|png|gif|bmp|svg|ico|woff2?|ttf|otf|eot|mp4|webm|m4v|mov|pdf|json)$/i;
const feedPath = /^(?:robots\.txt|(?:[a-z_-]+-)?sitemap(?:_index)?\.(?:xml|xsl))$/;
const privatePath = /(?:^|\/)(?:\.[^/]+|wp-admin|wp-login(?:\.php)?|wp-json|backups?)(?:\/|$)/i;
const pageFile = /(?:^|\/)index\.html$/;

const consultation = {
  en: 'Open consultation form on Gangnam Medical Concierge',
  zh: '前往 Gangnam Medical Concierge 填写咨询表',
  tw: '前往 Gangnam Medical Concierge 填寫諮詢表',
  id: 'Buka formulir konsultasi di Gangnam Medical Concierge',
  th: 'เปิดแบบฟอร์มปรึกษาที่ Gangnam Medical Concierge',
  ru: 'Открыть форму консультации на сайте Gangnam Medical Concierge',
};

async function* publicFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = resolve(directory, entry.name);
    const path = relative(input, filename).split(sep).join('/');
    if (privatePath.test(path) || path === 'gmc-preview/preview-only.js') continue;
    if (entry.isDirectory()) {
      yield* publicFiles(filename);
    } else if (entry.isFile() && (
      feedPath.test(path) ||
      pageFile.test(path) && !assetPath.test(path) && !path.startsWith('gmc-media/') ||
      assetPath.test(path) && assetExtension.test(path) ||
      /^gmc-media\/(?:trustindex\/.*\.svg|profile\/a-\/[a-zA-Z0-9_=-]+)$/.test(path)
    )) {
      yield path;
    }
  }
}

function urlPath(path) {
  return '/' + path.split('/').map(encodeURIComponent).join('/');
}

const files = new Set();
for await (const path of publicFiles(input)) files.add(path);
if (!files.has('index.html') || !files.has('gmc-preview/site.css') || !files.has('gmc-preview/site.js')) {
  throw new Error('The public build is incomplete. Run npm run copy before packaging.');
}

function copiedPath(url) {
  let path;
  try {
    path = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return null;
  }
  if (files.has(path)) return urlPath(path);
  const directory = path.replace(/\/$/, '');
  const prefix = directory ? directory + '/' : '';
  return files.has(prefix + 'index.html') ? urlPath(prefix) : null;
}

function rewriteSourceUrl(value, page, mode) {
  if (!value || value.startsWith('#')) return value;
  let url;
  try {
    url = new URL(value, page);
  } catch {
    return value;
  }
  if (url.origin !== origin) return value;
  const path = copiedPath(url);
  if (path) return path + url.search + url.hash;
  return mode === 'navigation' ? url.href : value;
}

function replaceConsultation($, pathname) {
  const locale = pathname.split('/')[1];
  const label = consultation[locale] || consultation.en;
  const sourcePath = label === consultation.en ? '/contact/' : `/${locale}/contact/`;
  const href = new URL(sourcePath, origin).href;
  let forms = 0;
  $('form.elementor-form').each((_, node) => {
    $(node).replaceWith($('<a/>').attr({ class: 'gmc-button', href }).text(label));
    forms++;
  });
  return forms;
}

function restoreEmail($) {
  $('a[href^="/cdn-cgi/l/email-protection#"]').each((_, node) => {
    const link = $(node);
    const hex = link.attr('href').split('#').at(-1);
    if (!/^(?:[a-f0-9]{2}){4,}$/i.test(hex)) return;
    const bytes = Buffer.from(hex, 'hex');
    const address = Buffer.from(bytes.subarray(1).map(byte => byte ^ bytes[0])).toString();
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(address)) return;
    link.attr('href', 'mailto:' + address);
    link.find('[data-cfemail]').replaceWith(address);
  });
  $('script[src*="/cdn-cgi/"][src*="email-decode"]').remove();
}

function deploymentHtml(html, path) {
  const $ = load(html);
  const pathname = urlPath(path.replace(/index\.html$/, ''));
  const page = new URL(pathname, origin);

  $('a[href]').each((_, node) => {
    const anchor = $(node);
    const href = anchor.attr('href');
    if (!href.startsWith('/cdn-cgi/')) anchor.attr('href', rewriteSourceUrl(href, page, 'navigation'));
  });
  $('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"], iframe[src], object[data]').each((_, node) => {
    const element = $(node);
    const attribute = ({ link: 'href', iframe: 'src', object: 'data' })[node.name];
    const value = element.attr(attribute);
    if (value) element.attr(attribute, rewriteSourceUrl(value, page, 'asset'));
  });

  restoreEmail($);
  const forms = replaceConsultation($, pathname);
  $('script[src^="/gmc-preview/preview-only.js"], script[id^="trp-"]').remove();
  const gallery = $('#list-2 .jet-listing-grid__items').length;
  const archive = $('body.blog .elementor-widget-archive-posts .elementor-posts-container, body.category .elementor-widget-archive-posts .elementor-posts-container').length;
  const hasStaticCollection = (gallery || archive) && $('.jet-filters-pagination').length &&
    files.has('gmc-preview/static-collections.js') && files.has('gmc-preview/static-collections.css');
  if (hasStaticCollection) {
    $('script[id^="jet-smart-filters-"], #jet-engine-jet-smart-filters-compatibility-js').remove();
    $('head').append('<link rel="stylesheet" href="/gmc-preview/static-collections.css">');
    $('body').append('<script src="/gmc-preview/static-collections.js" defer></script>');
  }
  return { html: $.html(), forms };
}

const copyAudit = await readFile(resolve(root, 'artifacts', 'copy-audit.json'), 'utf8').then(JSON.parse).catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return {};
});
const gone = (copyAudit.absentPages || []).flatMap(({ path, status }) => {
  if (status !== 410) return [];
  const url = new URL(path, origin);
  if (url.origin !== origin || copiedPath(url) || url.pathname === '/') return [];
  return url.pathname.replace(/\/$/, '');
});
const routeAudit = await readFile(resolve(root, 'artifacts', 'public-link-route-audit.json'), 'utf8')
  .then(JSON.parse).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return {};
  });
const redirects = (routeAudit.redirects || []).flatMap(({ source, destination, status }) => {
  if (status !== 301) return [];
  const from = new URL(source, origin);
  const to = new URL(destination, origin);
  if (from.origin !== origin || to.origin !== origin || copiedPath(from) || !copiedPath(to)) return [];
  return { source: from.pathname, destination: copiedPath(to), statusCode: status };
});

const temporary = await mkdtemp(resolve(root, '.snapshot-'));
const pages = {};
const assetContentTypes = {};
const stats = { pages: 0, assets: 0, formsLinked: 0 };
try {
  for (const path of files) {
    const from = resolve(input, path);
    if (pageFile.test(path)) {
      const transformed = deploymentHtml(await readFile(from, 'utf8'), path);
      const archived = `${path}.gz`;
      const destination = resolve(temporary, 'content', 'pages', archived);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, gzipSync(transformed.html));
      pages[urlPath(path.replace(/index\.html$/, ''))] = archived;
      stats.pages++;
      stats.formsLinked += transformed.forms;
    } else {
      if (path.startsWith('gmc-media/profile/')) {
        const header = (await readFile(from)).subarray(0, 16);
        const mime = header[0] === 0xff && header[1] === 0xd8 ? 'image/jpeg'
          : header[0] === 0x89 && header.toString('ascii', 1, 4) === 'PNG' ? 'image/png'
          : header.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
        if (mime) assetContentTypes[urlPath(path)] = mime;
      }
      const destination = resolve(temporary, 'public', path);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(from, destination);
      stats.assets++;
    }
  }
  const manifest = { pages, gone, redirects, assetContentTypes };
  await writeFile(resolve(temporary, 'content', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const directory of ['content', 'public']) {
    await rm(resolve(root, directory), { force: true, recursive: true });
    await rename(resolve(temporary, directory), resolve(root, directory));
  }
} finally {
  await rm(temporary, { force: true, recursive: true });
}

console.log(JSON.stringify({ ...stats, gone: gone.length, redirects: redirects.length }, null, 2));
