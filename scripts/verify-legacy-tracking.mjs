import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { load } from 'cheerio';
import { removeLegacyTracking } from '../lib/legacy-tracking.js';

const { values } = parseArgs({
  options: {
    'baseline-dir': { type: 'string' },
    'build-dir': { type: 'string' },
  },
});

const sample = `
<head>
  <link rel="dns-prefetch" href="//www.googletagmanager.com">
  <link rel="preconnect" href="https://maps.google.com">
</head>
<body>
  <noscript id="only-tracker"><iframe src="https://www.googletagmanager.com/ns.html?id=fixture"></iframe></noscript>
  <noscript id="mixed">Fallback content
    <iframe data-lazy-src="//googletagmanager.com/ns.html?id=fixture" src="about:blank"></iframe>
    <img src="/public-photo.jpg" alt="Existing image">
  </noscript>
  <iframe id="tag-frame" data-src="//www.googletagmanager.com/ns.html?id=fixture" src="about:blank"></iframe>
  <iframe src="https://maps.google.com/maps?output=embed" title="Location"></iframe>
  <iframe src="https://gangnammedicalconcierge.com/article/embed/" title="Public article"></iframe>
  <video controls poster="/cover.jpg"><source src="/original.mp4" type="video/mp4"></video>
  <img src="/gallery-photo.jpg" alt="Existing gallery image">
  <script src="https://cdn.trustindex.io/loader.js"></script>
  <script data-rocket-src="https://static.cloudflareinsights.com/beacon.min.js/vfixture"></script>
  <script src="https://www.google.com/recaptcha/api.js?render=fixture"></script>
  <form class="jet-color-image-list-wrapper"><input type="radio" name="category"></form>
  <a href="https://gangnammedicalconcierge.com/contact/">Consultation</a>
</body>`;

function mediaInventory(markup) {
  const $ = load(markup, { scriptingEnabled: false });
  const elements = $('img, source, video, audio, track, iframe, object, embed')
    .toArray().filter(node => node.name !== 'iframe' ||
      !['src', 'data-src', 'data-lazy-src', 'data-rocket-src'].some(attribute =>
        /^(?:https?:)?\/\/(?:www\.)?googletagmanager\.com\/ns\.html(?:[?#]|$)/i.test($(node).attr(attribute) || '')));
  return {
    markup: elements.map(node => $.html(node)),
    images: elements.filter(node => node.name === 'img' && !$(node).closest('noscript').length).length,
    embeds: elements.filter(node => node.name === 'iframe' && !$(node).closest('noscript').length).length,
  };
}

const $ = load(sample);
removeLegacyTracking($);
const html = $.html();
assert.doesNotMatch(html, /googletagmanager\.com|cloudflareinsights\.com|\/recaptcha\/api\.js/);
assert.equal($('#only-tracker, #tag-frame').length, 0);
assert.match($('#mixed').html(), /Fallback content/);
assert.equal($('a[href="https://gangnammedicalconcierge.com/contact/"]').length, 1);
assert.equal($('link[href="https://maps.google.com"], script[src="https://cdn.trustindex.io/loader.js"]').length, 2);
assert.deepEqual(mediaInventory(html), mediaInventory(sample));
removeLegacyTracking($);
assert.equal($.html(), html);

for (const protection of ['<form><input name="email" type="email"></form>', '<div class="g-recaptcha" data-sitekey="fixture"></div>']) {
  const form = load(sample.replace('</body>', protection + '</body>'));
  removeLegacyTracking(form);
  assert.equal(form('script[src*="/recaptcha/api.js"]').length, 1);
  assert.doesNotMatch(form.html(), /googletagmanager\.com|cloudflareinsights\.com/);
}

console.log('Legacy tracker markup, real forms, and user-media preservation passed.');

if (values['baseline-dir'] || values['build-dir']) {
  const { pages } = JSON.parse(await readFile(new URL('../content/manifest.json', import.meta.url), 'utf8'));
  const paths = Object.keys(pages);
  const summary = { pages: paths.length, images: 0, embeds: 0, sanitizedPages: 0 };
  for (const path of paths) {
    const file = path === '/' ? 'index.html' : path.slice(1, -1) + '.html';
    const [baseline, build] = await Promise.all([values['baseline-dir'], values['build-dir']]
      .map(directory => directory && readFile(resolve(directory, file), 'utf8')));
    const markup = build ?? baseline;
    const doc = load(markup);
    const before = doc.html();
    removeLegacyTracking(doc);
    const clean = doc.html();
    if (clean !== before) summary.sanitizedPages++;
    if (build) assert.ok(clean === before, `Legacy tracker survived in built page ${path}`);
    const retained = mediaInventory(clean);
    const original = mediaInventory(baseline ?? markup);
    assert.ok(equalMedia(retained, original), `Public media changed on ${path}`);
    summary.images += retained.images;
    summary.embeds += retained.embeds;
  }
  console.log(JSON.stringify(summary));
}

function equalMedia(after, before) {
  return after.markup.length === before.markup.length &&
    after.markup.every((markup, index) => markup === before.markup[index]);
}
