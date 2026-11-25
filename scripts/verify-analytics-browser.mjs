import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, devices, webkit } from 'playwright';

const { values } = parseArgs({
  options: { url: { type: 'string', default: 'http://127.0.0.1:4191' }, engine: { type: 'string' } },
});
const base = new URL(values.url);
if (!['http:', 'https:'].includes(base.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ||
    base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('--url must be a local HTTP(S) origin.');
}

const fixture = 'gmc-private-fixture';
const markers = [fixture, 'example.invalid', '5550199210'];
const dirty = `?utm_source=google&utm_medium=cpc&utm_campaign=${fixture}-campaign&email=${fixture}%40example.invalid#${fixture}-fragment`;
const referrer = `https://www.google.com/search?q=${fixture}-referrer`;
const consentKey = 'gmc-analytics-consent';
const allowedEvents = new Set([
  '$pageview', '$pageleave', '$web_vitals', 'page_scrolled', 'consultation_clicked',
  'consultation_handoff_clicked', 'contact_channel_clicked', 'language_selected', 'treatment_clicked',
  'faq_topic_selected', 'faq_answer_opened', 'gallery_filter_selected', 'gallery_photo_opened',
  'collection_paginated', 'article_link_clicked', 'article_share_clicked', 'site_navigation_clicked',
]);
const allowedProperties = new Set([
  'token', 'distinct_id', '$device_id', '$session_id', '$window_id', '$pageview_id',
  '$lib', '$lib_version', '$insert_id', '$browser', '$browser_version', '$os', '$device_type',
  '$screen_height', '$screen_width', '$viewport_height', '$viewport_width',
  'placement', 'destination_locale', 'contact_channel', 'article_placement', 'depth_percent',
  '$prev_pageview_duration', 'traffic_source', 'traffic_channel', '$referrer', '$referring_domain',
  'utm_source', 'utm_medium', '$process_person_profile', '$current_url', '$host', '$pathname',
  'language', 'page_type', ...['CLS', 'FCP', 'INP', 'LCP', 'TTFB'].map(key => `$web_vitals_${key}_value`),
]);

function decodePayload(request, url, beaconBody) {
  let buffer = request.postDataBuffer();
  let encoding = url.searchParams.get('compression');
  if (buffer?.[0] === 0x1f && buffer[1] === 0x8b) buffer = gunzipSync(buffer);
  let raw = buffer?.toString() || beaconBody || url.searchParams.get('data') || '';
  if (!raw) return '';
  if (raw.startsWith('data=') || raw.startsWith('compression=')) {
    const form = new URLSearchParams(raw);
    encoding = form.get('compression') || encoding;
    raw = form.get('data') || '';
  }
  if (encoding === 'base64' && !/^\s*[\[{]/.test(raw)) raw = Buffer.from(raw, 'base64').toString();
  return raw;
}

function parsePayload(raw) {
  if (!raw) return [];
  const decoded = JSON.parse(raw);
  if (Array.isArray(decoded)) return decoded;
  if (Array.isArray(decoded.batch)) return decoded.batch;
  return decoded.event ? [decoded] : [];
}

async function interceptPostHog(context) {
  const requests = [];
  const events = [];
  const errors = [];
  const beaconBodies = new Map();
  await context.exposeBinding('gmcTestPostHogBeacon', (_, url, body) => {
    const entries = beaconBodies.get(url) || [];
    entries.push(body);
    beaconBodies.set(url, entries);
  });
  // WebKit's route API reports beacon requests without their body. Observe the
  // SDK's string Blob at sendBeacon, then only inspect it for a matching route.
  await context.addInitScript(() => {
    const bodies = new WeakMap();
    window.Blob = new Proxy(window.Blob, {
      construct(target, args, newTarget) {
        const blob = Reflect.construct(target, args, newTarget);
        const [parts, options] = args;
        if (options?.type?.startsWith('text/plain') && Array.isArray(parts) && parts.every(part => typeof part === 'string')) {
          bodies.set(blob, parts.join(''));
        }
        return blob;
      },
    });
    const sendBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function (value, data) {
      const url = new URL(value, location.href);
      if (url.hostname === 'posthog.com' || url.hostname.endsWith('.posthog.com')) {
        const body = typeof data === 'string' ? data : bodies.get(data);
        if (body) window.gmcTestPostHogBeacon(url.href, body).catch(() => {});
      }
      return sendBeacon.call(this, value, data);
    };
  });
  await context.route(url => url.hostname === 'posthog.com' || url.hostname.endsWith('.posthog.com'), async route => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();
    const endpoint = url.pathname.replace(/\/$/, '');
    const replay = /^\/(?:s|snapshot)(?:\/|$)/.test(endpoint);
    const config = /^\/(?:flags|decide|array)(?:\/|$)/.test(endpoint);
    requests.push({ endpoint, replay });
    if (request.method() !== 'OPTIONS') {
      try {
        let beacon;
        if (!request.postDataBuffer()?.length && request.resourceType() === 'beacon') {
          const deadline = Date.now() + 600;
          while (!beaconBodies.get(url.href)?.length && Date.now() < deadline) await delay(20);
          beacon = beaconBodies.get(url.href)?.shift();
        }
        const payload = decodePayload(request, url, beacon);
        if ([url.href, payload, headers.referer || '', headers.cookie || ''].some(value => markers.some(marker => value.includes(marker)))) {
          errors.push(`Private fixture data in vendor request to ${endpoint}`);
        }
        if (!config && (request.method() === 'POST' || url.searchParams.has('data'))) {
          const decoded = parsePayload(payload);
          if (!decoded.length) errors.push(`Unexpected telemetry payload at ${endpoint} (${request.resourceType()}, ${url.searchParams.get('compression') || 'uncompressed'})`);
          events.push(...decoded);
        }
      } catch (error) {
        errors.push(`Unable to decode vendor request at ${endpoint}: ${error.name}`);
      }
    }
    const cors = {
      'Access-Control-Allow-Origin': base.origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': headers['access-control-request-headers'] || 'content-type',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const response = config ? {
      flags: {}, featureFlags: {}, featureFlagPayloads: {}, supportedCompression: ['base64'],
      sessionRecording: { endpoint: '/s/', sampleRate: '1', minimumDurationMilliseconds: 0 },
    } : { status: 1 };
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(response) });
  });
  return { requests, events, errors };
}

async function go(page, path) {
  const response = await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded' });
  assert.equal(response?.status(), 200, path);
  await page.locator('.gmc-header').waitFor();
  const marker = page.locator('[data-gmc-analytics-token]');
  assert.equal(await marker.getAttribute('data-gmc-analytics-host'), base.host, 'Use a build configured for this local analytics origin');
}

function choice(page) {
  return page.evaluate(() => localStorage.getItem('gmc-analytics-consent'));
}

async function assertNoRequests(ledger, since, label) {
  await delay(500);
  const extra = ledger.requests.slice(since).map(request => request.endpoint).join(', ');
  assert.equal(ledger.requests.length, since, `${label}: unexpected PostHog request (${extra})`);
}

async function waitEvent(ledger, name, since = 0, check = () => true) {
  const until = Date.now() + 7500;
  let event;
  while (!(event = ledger.events.slice(since).find(item => item.event === name && check(item.properties))) && Date.now() < until) {
    await delay(40);
  }
  assert.ok(event, `Missing ${name}. Observed events: ${ledger.events.slice(since).map(item => item.event).join(', ')}. ${ledger.errors.join('. ')}`);
  return event.properties;
}

function checkPageview(properties, pathname, pageType, language = 'en') {
  assert.equal(properties.$current_url, new URL(pathname, base).href);
  assert.equal(properties.$host, base.host);
  assert.equal(properties.$pathname, pathname);
  assert.equal(properties.page_type, pageType);
  assert.equal(properties.language, language);
}

async function clickWithoutLeaving(anchor, destination) {
  await anchor.evaluate((element, href) => {
    if (href) element.href = href;
    element.addEventListener('click', event => event.preventDefault(), { once: true });
  }, destination ?? null);
  await anchor.click();
}

async function checkBrowser(type, options) {
  const browser = await type.launch();
  const context = await browser.newContext({ ...options, reducedMotion: 'reduce', serviceWorkers: 'block' });
  try {
    const ledger = await interceptPostHog(context);
    await context.addInitScript(({ referrer, fixture }) => {
      Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => false });
      Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => undefined });
      if (window.location.search.includes(fixture) && window.location.pathname === '/faqs/') {
        Object.defineProperty(document, 'referrer', { configurable: true, get: () => referrer });
      }
    }, { referrer, fixture });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.setDefaultNavigationTimeout(30000);
    const allow = page.locator('[data-gmc-analytics-choice="granted"]');
    const decline = page.locator('[data-gmc-analytics-choice="denied"]');
    const settings = page.locator('[data-gmc-analytics-open]');
    const prompt = page.locator('#gmc-analytics-prompt');
    const faq = '/faqs/' + dirty;

    await go(page, faq);
    await prompt.waitFor({ state: 'visible' });
    assert.equal(await choice(page), null);
    await assertNoRequests(ledger, 0, 'Before opt-in');
    await decline.click();
    await prompt.waitFor({ state: 'hidden' });
    assert.equal(await choice(page), 'denied');
    const reload = await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(reload?.status(), 200);
    assert.equal(await choice(page), 'denied');
    assert.ok(!await prompt.isVisible());
    await assertNoRequests(ledger, 0, 'After decline and reload');

    await settings.click();
    await allow.click();
    await prompt.waitFor({ state: 'hidden' });
    assert.equal(await choice(page), 'granted');
    const view = await waitEvent(ledger, '$pageview');
    checkPageview(view, '/faqs/', 'faq');
    assert.equal(view.$referrer, 'https://google.com/');
    assert.equal(view.$referring_domain, 'google.com');
    assert.equal(view.utm_source, 'google');
    assert.equal(view.utm_medium, 'cpc');
    assert.equal(view.traffic_channel, 'paid_search');

    await page.locator('.e-n-tabs.e-activated').first().waitFor();
    const topic = page.locator('.e-n-tabs-heading [role="tab"]').nth(1);
    await topic.click();
    const topicId = await topic.getAttribute('id');
    await page.locator(`#${topicId}[aria-selected="true"]`).waitFor();
    await waitEvent(ledger, 'faq_topic_selected');
    const summary = page.locator('details.e-n-accordion-item:not([open]) > summary:visible').first();
    await summary.click();
    await waitEvent(ledger, 'faq_answer_opened');

    const toggle = page.locator('.gmc-menu-toggle:visible');
    if (await toggle.count()) await toggle.click();
    await page.locator('.gmc-language-menu > summary').click();
    const tw = page.locator('.gmc-languages a[lang="zh-TW"]');
    await tw.evaluate((anchor, query) => { anchor.href += query; }, dirty);
    const languageStart = ledger.events.length;
    await Promise.all([
      page.waitForURL(url => url.pathname === '/tw/faqs/', { waitUntil: 'commit' }),
      tw.click(),
    ]);
    await waitEvent(ledger, 'language_selected', languageStart, props => props.destination_locale === 'tw');
    checkPageview(await waitEvent(ledger, '$pageview', languageStart, props => props.language === 'tw'), '/tw/faqs/', 'faq', 'tw');
    assert.equal(await choice(page), 'granted');
    assert.ok(!await prompt.isVisible());

    const ctaStart = ledger.events.length;
    await Promise.all([
      page.waitForURL(url => url.pathname === '/tw/contact/', { waitUntil: 'commit' }),
      page.locator('.gmc-header-cta').click(),
    ]);
    await waitEvent(ledger, 'consultation_clicked', ctaStart, props => props.placement === 'header');
    checkPageview(await waitEvent(ledger, '$pageview', ctaStart, props => props.page_type === 'contact'), '/tw/contact/', 'contact', 'tw');
    const handoff = page.locator('.elementor-widget-form a.gmc-button');
    await clickWithoutLeaving(handoff, 'https://gangnammedicalconcierge.com/tw/contact/' + dirty);
    await waitEvent(ledger, 'consultation_handoff_clicked', ctaStart);
    assert.equal(new URL(page.url()).pathname, '/tw/contact/');

    const whatsApp = page.locator('a[href^="https://wa.me/"]:visible').first();
    await clickWithoutLeaving(whatsApp, `https://wa.me/5550199210?text=${fixture}-prefill`);
    await waitEvent(ledger, 'contact_channel_clicked', ctaStart, props => props.contact_channel === 'whatsapp');

    const galleryStart = ledger.events.length;
    await go(page, '/bna-gallery/');
    checkPageview(await waitEvent(ledger, '$pageview', galleryStart, props => props.page_type === 'gallery'), '/bna-gallery/', 'gallery');
    const photo = page.locator('.gmc-collection-gallery .gmc-collection-tile').first();
    await photo.evaluate((button, sample) => {
      button.setAttribute('aria-label', sample + '-case');
      button.querySelector('img').alt = sample + '-image';
    }, fixture);
    await photo.click();
    await waitEvent(ledger, 'gallery_photo_opened', galleryStart);
    await page.locator('.gmc-collection-photo[open] .gmc-collection-dismiss').click();

    const queryStart = ledger.events.length;
    await go(page, '/faqs/?email=' + fixture + '%40example.invalid');
    checkPageview(await waitEvent(ledger, '$pageview', queryStart, props => props.page_type === 'faq'), '/faqs/', 'faq');

    const hashStart = ledger.events.length;
    await go(page, '/#' + fixture + '-only');
    checkPageview(await waitEvent(ledger, '$pageview', hashStart, props => props.page_type === 'home'), '/', 'home');

    await delay(1300);
    assert.ok(!ledger.requests.some(request => request.replay), 'An excluded page used the replay endpoint');
    assert.ok(!ledger.events.some(event => event.event === '$snapshot'), 'An excluded page sent a replay event');
    assert.deepEqual(ledger.errors, []);
    assert.equal(ledger.events.filter(event => event.event === '$pageview').length, 6);
    for (const name of [
      'faq_topic_selected', 'faq_answer_opened', 'language_selected', 'consultation_clicked',
      'consultation_handoff_clicked', 'contact_channel_clicked', 'gallery_photo_opened',
    ]) {
      assert.equal(ledger.events.filter(event => event.event === name).length, 1, `Expected one ${name}`);
    }
    for (const { event, properties } of ledger.events) {
      assert.ok(allowedEvents.has(event), `Unexpected event: ${event}`);
      assert.ok(Object.keys(properties).every(key => allowedProperties.has(key)), `Unexpected properties in ${event}`);
      assert.equal(properties.$process_person_profile, false);
      const raw = JSON.stringify(properties);
      for (const marker of markers) assert.ok(!raw.includes(marker), `Private fixture data in ${event}`);
      const url = new URL(properties.$current_url);
      assert.equal(url.origin, base.origin);
      assert.equal(url.pathname, properties.$pathname);
      assert.equal(url.search + url.hash, '');
    }

    await settings.click();
    await prompt.waitFor({ state: 'visible' });
    await delay(300); // Finish any scroll event from revealing the settings button while consent is still granted.
    const revokedStart = ledger.requests.length;
    await decline.click();
    await prompt.waitFor({ state: 'hidden' });
    assert.equal(await choice(page), 'denied');
    await go(page, '/contact/');
    assert.equal(await choice(page), 'denied');
    await clickWithoutLeaving(page.locator('.elementor-widget-form a.gmc-button'));
    await assertNoRequests(ledger, revokedStart, 'After revocation, new navigation and consultation click');

    console.log(`${type.name()}: consent, persistence, redaction, named events, and replay exclusions passed (${ledger.events.length} captured events).`);
  } finally {
    await context.close();
    await browser.close();
  }
}

const plans = {
  chromium: [chromium, { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }],
  webkit: [webkit, devices['iPhone 13']],
};
const engines = values.engine ? [values.engine] : Object.keys(plans);
assert.ok(engines.every(engine => Object.hasOwn(plans, engine)), '--engine must be chromium or webkit');
const results = await Promise.allSettled(engines.map(engine => checkBrowser(...plans[engine])));
for (const [index, result] of results.entries()) {
  if (result.status === 'fulfilled') continue;
  console.error(engines[index], result.reason);
  process.exitCode = 1;
}
