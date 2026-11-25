import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { chromium, webkit } from 'playwright';

const { values } = parseArgs({
  options: { url: { type: 'string', default: 'http://127.0.0.1:3000' } },
});
const base = new URL(values.url);
if (!['http:', 'https:'].includes(base.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ||
    base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('--url must be a local HTTP(S) origin.');
}

const localizedLabels = {
  '/': ['Website analytics', 'Privacy settings'],
  '/zh/': ['网站分析', '隐私设置'],
  '/tw/': ['網站分析', '隱私設定'],
  '/id/': ['Analitik situs', 'Pengaturan privasi'],
  '/th/': ['การวิเคราะห์เว็บไซต์', 'การตั้งค่าความเป็นส่วนตัว'],
  '/ru/': ['Аналитика сайта', 'Настройки конфиденциальности'],
};

async function isolatedContext(browser, options) {
  const context = await browser.newContext({ ...options, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.testConsentEvents = [];
    window.addEventListener('gmc:analytics-consent', event => window.testConsentEvents.push(event.detail));
  });
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    const type = request.resourceType();
    const trackingScript = type === 'script' && /analytics|posthog/i.test(url.pathname) &&
      url.pathname !== '/gmc-preview/analytics-consent.js';
    if (url.origin !== base.origin || !['GET', 'HEAD'].includes(request.method()) ||
        ['xhr', 'fetch', 'ping', 'beacon'].includes(type) || trackingScript) return route.abort();
    return route.continue();
  });
  return context;
}

function controls(page) {
  return {
    prompt: page.locator('#gmc-analytics-prompt'),
    title: page.locator('#gmc-analytics-title'),
    decline: page.locator('[data-gmc-analytics-choice="denied"]'),
    allow: page.locator('[data-gmc-analytics-choice="granted"]'),
    settings: page.locator('[data-gmc-analytics-open]'),
    disabled: page.locator('[data-gmc-analytics-state="denied"]'),
  };
}

function savedChoice(page) {
  return page.evaluate(() => localStorage.getItem('gmc-analytics-consent'));
}

function events(page) {
  return page.evaluate(() => window.testConsentEvents);
}

async function assertEqualAccess(page, prompt, decline, allow) {
  const [panel, left, right, viewport] = await Promise.all([
    prompt.boundingBox(), decline.boundingBox(), allow.boundingBox(),
    page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  ]);
  assert.ok(panel && panel.x >= 0 && panel.x + panel.width <= viewport.width + 1);
  assert.ok(panel.y >= 0 && panel.y + panel.height <= viewport.height + 1);
  assert.ok(left && right && left.height >= 44 && right.height >= 44);
  assert.ok(Math.abs(left.width - right.width) < 1 && Math.abs(left.height - right.height) < 1);
  const appearance = button => button.evaluate(element => {
    const style = getComputedStyle(element);
    return [style.backgroundColor, style.color, style.borderColor, style.fontWeight];
  });
  assert.deepEqual(await appearance(decline), await appearance(allow));
}

async function checkLocale(browser, options, path, labels) {
  const context = await isolatedContext(browser, options);
  try {
    const page = await context.newPage();
    const { prompt, title, decline, allow, settings, disabled } = controls(page);
    const response = await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded' });
    assert.equal(response?.status(), 200);
    await prompt.waitFor({ state: 'visible' });
    assert.equal((await title.textContent()).trim(), labels[0]);
    assert.equal((await settings.textContent()).trim(), labels[1]);
    assert.equal(await savedChoice(page), null);
    assert.deepEqual(await events(page), []);
    await assertEqualAccess(page, prompt, decline, allow);

    await decline.press('Enter');
    await prompt.waitFor({ state: 'hidden' });
    assert.equal(await savedChoice(page), 'denied');
    assert.deepEqual(await events(page), ['denied']);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await settings.waitFor({ state: 'visible' });
    assert.ok(!await prompt.isVisible());
    assert.equal(await savedChoice(page), 'denied');
    assert.deepEqual(await events(page), []);

    await settings.press('Enter');
    await disabled.waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'gmc-analytics-title');
    await page.keyboard.press('Escape');
    await prompt.waitFor({ state: 'hidden' });
    assert.ok(await settings.evaluate(element => element === document.activeElement));

    await settings.press('Enter');
    await allow.press('Enter');
    await prompt.waitFor({ state: 'hidden' });
    assert.equal(await savedChoice(page), 'granted');
    assert.deepEqual(await events(page), ['granted']);

    const sibling = await context.newPage();
    const siblingControls = controls(sibling);
    await sibling.goto(new URL(path === '/tw/' ? '/' : '/tw/', base).href, { waitUntil: 'domcontentloaded' });
    await siblingControls.settings.waitFor({ state: 'visible' });
    assert.ok(!await siblingControls.prompt.isVisible());
    assert.equal(await savedChoice(sibling), 'granted');
    assert.deepEqual(await events(sibling), []);

    await settings.press('Enter');
    await decline.press('Enter');
    await prompt.waitFor({ state: 'hidden' });
    assert.equal(await savedChoice(page), 'denied');
    assert.deepEqual(await events(page), ['granted', 'denied']);
    await sibling.waitForFunction(() => window.testConsentEvents.includes('denied'));
    assert.equal(await savedChoice(sibling), 'denied');
    assert.ok(!await siblingControls.prompt.isVisible());
  } finally {
    await context.close();
  }
}

async function checkBrowser(browserType, options) {
  const browser = await browserType.launch();
  try {
    for (const [path, labels] of Object.entries(localizedLabels)) {
      await checkLocale(browser, options, path, labels);
      console.log(`${browserType.name()} ${options.viewport.width}px ${path} passed`);
    }
  } finally {
    await browser.close();
  }
}

await Promise.all([
  checkBrowser(chromium, { viewport: { width: 1440, height: 900 } }),
  checkBrowser(webkit, { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true }),
]);
