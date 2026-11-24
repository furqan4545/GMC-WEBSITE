import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { gunzipSync } from 'node:zlib';
import { load } from 'cheerio';
import { repairEditorialLinks } from '../lib/editorial.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const snapshot = resolve(root, 'content');
const output = resolve(root, '.next/server/pages');
const publicDirectory = resolve(root, 'public');
const sourceHost = 'gangnammedicalconcierge.com';
const origin = new URL(process.env.GMC_LINK_AUDIT_BASE || 'http://127.0.0.1:4178');
const args = new Set(process.argv.slice(2));
const probeLocal = args.has('--local');
const probeExternal = args.has('--external');
const reportPath = resolve(root, 'artifacts', 'site-link-audit' + (probeLocal ? '-local' : '') + (probeExternal ? '-external' : '') + '.json');
const { pages, redirects, gone } = JSON.parse(await readFile(resolve(snapshot, 'manifest.json'), 'utf8'));
const built = new Set(await readdir(output, { recursive: true }));
const expected = new Map();
for (const path of Object.keys(pages)) expected.set(path, { status: 200 });
for (const path of gone) expected.set(routePath(path), { status: 410 });
for (const { source, destination, statusCode } of redirects) {
  expected.set(routePath(source), { status: statusCode || 308, destination });
}
const links = new Map();
const fragments = new Map();
const pageIds = new Map();
const comparisonIssues = [];
const collectionTargets = new Map();
const collectionIssues = [];
let preparedOccurrences = 0;
let compiledOccurrences = 0;
let consolidatedOccurrences = 0;
let repairedHrefOccurrences = 0;
let removedPlaceholderOccurrences = 0;
let collectionArticleLinks = 0;
let collectionGalleryImages = 0;

function routePath(path) {
  return path === '/' ? path : path.replace(/\/?$/, '/');
}

function builtPath(path) {
  const encoded = (path.slice(1).replace(/\/$/, '') || 'index') + '.html';
  return [encoded, decodeURIComponent(encoded)].find(file => built.has(file));
}

function hrefs($) {
  return $('a[href], area[href]').toArray().map(node => $(node).attr('href').trim());
}

function unmatchedHrefCount(before, after) {
  const counts = new Map();
  for (const href of after) counts.set(href, (counts.get(href) || 0) + 1);
  let unmatched = 0;
  for (const href of before) {
    if (counts.get(href)) counts.set(href, counts.get(href) - 1);
    else unmatched++;
  }
  return unmatched;
}

function append(map, key, factory, source) {
  let item = map.get(key);
  if (!item) {
    item = { ...factory, occurrences: 0, samples: [] };
    map.set(key, item);
  }
  item.occurrences++;
  if (item.samples.length < 5 && !item.samples.includes(source)) item.samples.push(source);
}

function absolute(raw, source) {
  return new URL(raw, new URL(source, origin));
}

const actionPath = /(?:^|\/)(?:wp-admin|wp-login(?:\.php)?|login|log-in|sign-in|signup|sign-up|register|logout|log-out|account|my-account|auth|oauth|checkout|cart|unsubscribe|confirm|confirmation|reset(?:-password)?|delete|remove|activate|download-attachment|admin-ajax\.php)(?:\/|$)/i;
const actionQuery = /(?:auth|token|nonce|signature|credential|secret|password|session|email|phone|patient|invite|redirect|continue|callback|add[ _-]?to[ _-]?cart|action|key|code)/i;
const intentHosts = new Set(['wa.me', 'api.whatsapp.com', 'line.me', 'lin.ee', 'm.me', 't.me', 'open.kakao.com', 'telegram.me']);
const externalShare = /(?:^|\/)(?:share|sharer|sharing|intent|sharer\.php|shareArticle)(?:\/|$)/i;
const intentProtocols = new Set(['mailto:', 'tel:', 'sms:', 'whatsapp:', 'line:', 'skype:', 'tg:', 'kakaotalk:', 'fb-messenger:']);

function riskyRequest(url, external) {
  if (url.username || url.password) return true;
  if (external && url.port) return true;
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return true;
  }
  return actionPath.test(path) || [...url.searchParams.keys()].some(key => actionQuery.test(key));
}

function intentFormat(url) {
  if (url.protocol === 'mailto:') {
    return decodeURIComponent(url.pathname).split(',').every(address => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(address));
  }
  if (url.protocol === 'tel:' || url.protocol === 'sms:') {
    return /^\+?[\d()., -]{3,}(?:;ext=\d+)?$/.test(decodeURIComponent(url.pathname));
  }
  return Boolean(url.pathname);
}

async function classify(raw, source) {
  if (/^(?:|#|javascript:\s*void\s*\(\s*0\s*\)\s*;?)$/i.test(raw)) return ['placeholder', raw || '(empty href)'];
  if (raw.startsWith('#elementor-action')) return ['interaction', 'Elementor page control'];
  let url;
  try {
    url = absolute(raw, source);
    decodeURIComponent(url.pathname);
  } catch {
    return ['invalid', raw.split(/[?#]/)[0].slice(0, 100)];
  }
  if (intentProtocols.has(url.protocol)) return [intentFormat(url) ? 'intent' : 'invalid', url.protocol + url.pathname];
  if (!['http:', 'https:'].includes(url.protocol)) return ['skipped-scheme', url.protocol];

  const local = url.origin === origin.origin;
  const original = url.hostname === sourceHost || url.hostname === 'www.' + sourceHost;
  if (riskyRequest(url, !local)) return ['skipped-action', url.origin + url.pathname];
  if (!local && (intentHosts.has(url.hostname) || externalShare.test(url.pathname))) {
    return ['intent', url.origin + url.pathname];
  }

  url.hash = '';
  if (!local) return [original ? 'original-wordpress' : 'external', url.href];

  const path = routePath(url.pathname);
  if (expected.has(path)) return ['local-route', url.href, expected.get(path)];
  const file = resolve(publicDirectory, '.' + decodeURIComponent(url.pathname));
  if (file.startsWith(publicDirectory + sep) && (await stat(file).catch(() => null))?.isFile()) {
    return ['local-asset', url.href, { status: 200 }];
  }
  return ['unmapped-local', url.href];
}

function validatePublicAddress(address) {
  if (isIP(address) === 6) return /^[23]/.test(address) && !/^2001:db8:/i.test(address);
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return a > 0 && a < 224 && ![10, 127].includes(a) &&
    !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && [0, 168].includes(b)) &&
    !(a === 198 && ([18, 19].includes(b) || b === 51 && c === 100)) &&
    !(a === 203 && b === 0 && c === 113);
}

function externalAllowed(url) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  return ['http:', 'https:'].includes(url.protocol) && !riskyRequest(url, true) &&
    !intentHosts.has(url.hostname) && !externalShare.test(url.pathname) &&
    (isIP(hostname) ? validatePublicAddress(hostname) : hostname.includes('.') && !/\.(?:internal|invalid|local|test|localhost)$/i.test(hostname));
}

function keyFor(raw, source) {
  return raw + (raw.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(raw) ? '' : ' ' + source);
}

const classification = new Map();
for (const [path, file] of Object.entries(pages)) {
  const builtFile = builtPath(path);
  const prepared = load(gunzipSync(await readFile(resolve(snapshot, 'pages', file))).toString('utf8'));
  const archivedHrefs = hrefs(prepared);
  preparedOccurrences += archivedHrefs.length;
  repairEditorialLinks(prepared, path);
  const fromSnapshot = hrefs(prepared);
  const removed = Math.max(0, archivedHrefs.length - fromSnapshot.length);
  removedPlaceholderOccurrences += removed;
  repairedHrefOccurrences += unmatchedHrefCount(archivedHrefs, fromSnapshot) - removed;
  const compiled = builtFile ? load(await readFile(resolve(output, builtFile), 'utf8')) : null;
  if (!compiled) comparisonIssues.push({ path, issue: 'Missing compiled page' });
  const fromBuild = compiled ? hrefs(compiled) : fromSnapshot;
  if (compiled) {
    compiledOccurrences += fromBuild.length;
    const preparedDestinations = [...new Set(fromSnapshot)];
    const compiledDestinations = [...new Set(fromBuild)];
    if (JSON.stringify(preparedDestinations) !== JSON.stringify(compiledDestinations)) {
      comparisonIssues.push({ path, issue: 'Prepared and compiled distinct href sequence differs', prepared: preparedDestinations.length, compiled: compiledDestinations.length });
    } else {
      consolidatedOccurrences += fromSnapshot.length - fromBuild.length;
    }
  }
  const $ = compiled || prepared;
  pageIds.set(path, new Set($('[id], a[name]').toArray().flatMap(node => [$(node).attr('id'), $(node).attr('name')].filter(Boolean))));
  for (const raw of fromBuild) {
    const key = keyFor(raw, path);
    if (!classification.has(key)) classification.set(key, await classify(raw, path));
    const [kind, url, status] = classification.get(key);
    append(links, kind + ' ' + url, { kind, url, expected: status }, path);
    if (kind.startsWith('local-') && raw.includes('#')) {
      const parsed = absolute(raw, path);
      if (parsed.hash) append(fragments, parsed.pathname + parsed.hash, { path: routePath(parsed.pathname), hash: parsed.hash }, path);
    }
  }
}

for (const locale of ['en', 'zh', 'tw', 'id', 'th', 'ru', 'gallery']) {
  const endpoint = '/gmc-preview/collections/' + locale + '.json';
  const file = resolve(publicDirectory, '.' + endpoint);
  try {
    const entries = JSON.parse(await readFile(file, 'utf8'));
    collectionTargets.set(new URL(endpoint, origin).href, { status: 200 });
    for (const entry of entries) {
      if (locale === 'gallery') {
        collectionGalleryImages++;
      } else {
        collectionArticleLinks++;
        const prefix = /^\/(zh|tw|id|th|ru)\//.exec(entry.route)?.[1] || 'en';
        if (prefix !== locale || !Object.hasOwn(pages, entry.route)) {
          collectionIssues.push({ endpoint, route: entry.route, issue: 'Missing article in the expected locale' });
        }
      }
      const [kind, url, status] = await classify(entry.image || '', endpoint);
      if (kind === 'local-asset') collectionTargets.set(url, status);
      else collectionIssues.push({ endpoint, image: entry.image, issue: 'Missing local image' });
    }
  } catch (error) {
    collectionIssues.push({ endpoint, issue: error.message });
  }
}

function request(url, method, external) {
  return new Promise((done, fail) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const options = {
      method,
      signal: AbortSignal.timeout(external ? 7000 : 9000),
      headers: { 'User-Agent': 'GMC public website link check' },
    };
    if (external) {
      options.lookup = (hostname, lookupOptions, callback) => {
        lookup(hostname, { all: true }).then(addresses => {
          if (!addresses.length || addresses.some(({ address }) => !validatePublicAddress(address))) {
            return callback(new Error('Destination did not resolve exclusively to public addresses'));
          }
          if (lookupOptions.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        }, callback);
      };
    }
    const call = transport(url, options, response => {
      done({ status: response.statusCode, location: response.headers.location, challenge: response.headers['cf-mitigated'] === 'challenge' });
      response.destroy();
    });
    call.setTimeout(external ? 7000 : 9000, () => call.destroy(new Error('Request timed out')));
    call.on('error', fail);
    call.end();
  });
}

async function concurrent(items, width, work) {
  let next = 0;
  return Promise.all(Array.from({ length: Math.min(items.length, width) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

const redirectsToFollow = new Set([301, 302, 303, 307, 308]);
async function trace(input, external) {
  let url = new URL(input);
  const steps = [];
  for (let hop = 0; hop < 5; hop++) {
    if (external ? !externalAllowed(url) : url.origin !== origin.origin || riskyRequest(url, false)) {
      return { steps, blocked: 'Redirect or direct target outside the safe GET/HEAD scope' };
    }
    try {
      let result = await request(url, 'HEAD', external);
      if ([405, 501].includes(result.status)) result = await request(url, 'GET', external);
      const { status, location, challenge } = result;
      const next = location ? new URL(location, url) : null;
      steps.push({ status, origin: url.origin, path: url.pathname, destinationOrigin: next?.origin, destination: next?.pathname, challenge });
      if (!next || !redirectsToFollow.has(status)) return { steps, status, challenge };
      if (external) await delay(500);
      url = next;
    } catch (error) {
      return { steps, error: error.message };
    }
  }
  return { steps, error: 'Too many redirects' };
}

const localFailures = [];
let localChecked = 0;
async function checkLocalLinks() {
  const targets = new Map([...expected].map(([path, status]) => [new URL(path, origin).href, status]));
  for (const [url, status] of collectionTargets) targets.set(url, status);
  for (const item of links.values()) {
    if (item.kind.startsWith('local-')) targets.set(item.url, item.expected);
    else if (item.kind === 'unmapped-local') targets.set(item.url, { status: 200 });
  }
  console.log('Testing ' + targets.size + ' distinct local route and asset targets.');
  await concurrent([...targets], 8, async ([url, status]) => {
    const actual = await trace(url, false);
    localChecked++;
    const matched = actual.steps.some(step => step.status === status.status &&
      (!status.destination || step.destination === new URL(status.destination, origin).pathname));
    const final = status.destination ? 200 : status.status;
    if (!matched || actual.status !== final) {
      localFailures.push({ url, expected: status, actual });
    }
  });
}

const externalResults = [];
async function checkExternalLinks() {
  const targets = [...links.values()].filter(({ kind }) => kind === 'original-wordpress' || kind === 'external');
  const hosts = new Map();
  for (const item of targets) {
    const hostname = new URL(item.url).hostname;
    if (!hosts.has(hostname)) hosts.set(hostname, []);
    hosts.get(hostname).push(item);
  }
  console.log('Testing ' + targets.length + ' ordinary external targets across ' + hosts.size + ' hosts.');
  await concurrent([...hosts.values()], 6, async group => {
    for (const item of group) {
      const result = await trace(item.url, true);
      const category = result.blocked ? 'skipped-action' : result.challenge || [401, 403, 429, 503].includes(result.status) ? 'protected' :
        result.status >= 200 && result.status < 300 ? 'reachable' : 'unreachable';
      externalResults.push({ ...item, result, category });
      if (externalResults.length % 100 === 0) console.log(externalResults.length + '/' + targets.length + ' external targets checked.');
      await delay(500);
    }
  });
}

const unresolvedFragments = [...fragments.values()].filter(({ path, hash }) => {
  const ids = pageIds.get(path);
  if (!ids) return false;
  try {
    return !ids.has(decodeURIComponent(hash.slice(1)));
  } catch {
    return true;
  }
});
const counts = Object.fromEntries(Object.entries(Object.groupBy(links.values(), item => item.kind)).map(([kind, items]) => [
  kind, { targets: items.length, occurrences: items.reduce((total, item) => total + item.occurrences, 0) },
]));
const collections = { articleLinks: collectionArticleLinks, galleryImages: collectionGalleryImages, localTargets: collectionTargets.size, issues: collectionIssues };
console.log(JSON.stringify({ pages: pageIds.size, preparedOccurrences, compiledOccurrences, consolidatedOccurrences, repairedHrefOccurrences, removedPlaceholderOccurrences, comparisonIssues: comparisonIssues.length, counts, checkedStaticFragments: fragments.size, unresolvedFragments: unresolvedFragments.length, collections }));

await Promise.all([
  probeLocal ? checkLocalLinks() : null,
  probeExternal ? checkExternalLinks() : null,
]);
const linksByKind = Object.groupBy(links.values(), item => item.kind);
const report = {
  pages: pageIds.size, preparedOccurrences, compiledOccurrences, consolidatedOccurrences, repairedHrefOccurrences, removedPlaceholderOccurrences, counts, comparisonIssues, unresolvedFragments, collections,
  unmappedLocal: linksByKind['unmapped-local'] || [],
  malformed: linksByKind.invalid || [],
  skipped: [...(linksByKind['skipped-action'] || []), ...(linksByKind['skipped-scheme'] || [])],
  intents: linksByKind.intent || [],
  interactions: linksByKind.interaction || [],
  originalWordPressFallbacks: linksByKind['original-wordpress'] || [],
  externalTargets: linksByKind.external || [],
  localChecked, localFailures, externalResults,
};
await mkdir(resolve(root, 'artifacts'), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ reportPath, localChecked, localFailures: localFailures.length, external: Object.fromEntries(Object.entries(Object.groupBy(externalResults, item => item.category)).map(([key, items]) => [key, items.length])) }));
if (probeLocal && (report.unmappedLocal.length || report.malformed.length || localFailures.length || comparisonIssues.length || unresolvedFragments.length || collectionIssues.length)) process.exitCode = 1;
