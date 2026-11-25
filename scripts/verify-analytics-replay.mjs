import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { chromium, devices, webkit } from 'playwright';

const { values } = parseArgs({ options: { url: { type: 'string', default: 'http://127.0.0.1:4191' } } });
const base = new URL(values.url);
assert.ok(/^http:\/\/(?:localhost|127\.0\.0\.1):\d+\/$/.test(base.href), 'Use a local fixture build.');
const collector = new Set(['us.i.posthog.com', 'us-assets.i.posthog.com']);
const sentinel = 'GMC_REPLAY_PRIVATE_FIXTURE';

function uncompress(bytes) {
  return bytes[0] === 31 && bytes[1] === 139 ? gunzipSync(bytes) : bytes;
}

function payload(request) {
  const bytes = request.postDataBuffer();
  if (!bytes) return [];
  const raw = uncompress(bytes).toString('utf8');
  let value;
  if (raw.trimStart().startsWith('{') || raw.trimStart().startsWith('[')) value = JSON.parse(raw);
  else {
    const encoded = new URLSearchParams(raw).get('data');
    value = JSON.parse(uncompress(Buffer.from(encoded, 'base64')).toString('utf8'));
  }
  return value.batch || (Array.isArray(value) ? value : [value]);
}

function expandSnapshot(data) {
  if (Array.isArray(data)) return data.map(expandSnapshot);
  if (data && typeof data === 'object') {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, expandSnapshot(value)]));
  }
  if (typeof data === 'string') {
    const bytes = Buffer.from(data, 'latin1');
    if (bytes[0] === 31 && bytes[1] === 139) return expandSnapshot(JSON.parse(gunzipSync(bytes).toString('utf8')));
  }
  return data;
}

async function waitFor(check, failure) {
  const deadline = Date.now() + 16000;
  while (!check() && Date.now() < deadline) await delay(80);
  assert.ok(check(), failure);
}

for (const [name, engine, device] of [['chromium', chromium, devices['Desktop Chrome']], ['webkit', webkit, devices['iPhone 13']]]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext(device);
    // These sessions use a fake key and all vendor requests are intercepted below.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
    });
    const captured = [];
    const decodingErrors = [];
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (collector.has(url.hostname)) {
        try { captured.push(...payload(request)); } catch (error) { decodingErrors.push(error.message); }
        await route.fulfill({
          json: { status: 1, hasFeatureFlags: false, sessionRecording: { endpoint: '/s/', minimumDurationMilliseconds: 0 } },
          headers: { 'access-control-allow-origin': '*' },
        });
      } else if (url.origin === base.origin) await route.continue();
      else await route.abort();
    });
    const page = await context.newPage();
    await page.goto(base.href, { waitUntil: 'domcontentloaded' });
    const configured = await page.locator('[data-gmc-analytics-token]').getAttribute('data-gmc-analytics-token');
    assert.equal(configured, 'phc_syntheticAnalyticsTestingOnly');
    await page.evaluate(value => {
      const fixture = document.createElement('aside');
      fixture.innerHTML = `<p data-private="${value}">${value}</p><form><input value="${value}"></form>` +
        `<a href="mailto:${value}@example.test">Fixture outreach</a>` +
        `<img src="/nonexistent-${value}.png" alt="${value}">`;
      document.querySelector('main').append(fixture);
    }, sentinel);
    assert.equal(captured.length, 0);
    await page.locator('[data-gmc-analytics-choice="granted"]').click();
    await waitFor(() => captured.some(event => event.event === '$pageview'), 'No page view after opt-in');
    await page.evaluate(() => scrollTo(0, 370));
    await waitFor(() => captured.some(event => event.event === '$snapshot'), 'No replay after opt-in');
    assert.deepEqual(decodingErrors, []);
    const snapshotData = captured.filter(event => event.event === '$snapshot').flatMap(event => expandSnapshot(event.properties.$snapshot_data));
    assert.ok(snapshotData.some(event => event.type === 2), 'Replay did not include a full DOM snapshot');
    assert.ok(!JSON.stringify(snapshotData).includes(sentinel), 'Replay exposed private DOM fixture data');
    assert.ok(!JSON.stringify(captured).includes(sentinel), 'Event telemetry exposed fixture data');

    const preferences = page.locator('[data-gmc-analytics-open]');
    await preferences.click();
    await page.locator('[data-gmc-analytics-choice="denied"]').click();
    const count = captured.length;
    await page.evaluate(() => scrollTo(0, 710));
    await delay(3500);
    assert.equal(captured.length, count, 'Capture continued after revocation');
    console.log(`${name}: decoded a masked replay, confirmed private fixture data was absent, and verified revocation`);
  } finally {
    await browser.close();
  }
}
