import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit, devices } from 'playwright';

const base = process.env.GMC_PREVIEW_URL || 'http://127.0.0.1:4177';
const deployed = process.env.GMC_CHECK_DEPLOYMENT === '1';
const indexable = deployed && process.env.GMC_CHECK_INDEXABLE === '1';
const wordpress = 'https://gangnammedicalconcierge.com';
const consultationLink = '.elementor-widget-form a.gmc-button';
const destinations = [
  ['homepage', '/', '.gmc-hero h1'],
  ['treatment', '/dental-veneers/', '.gmc-visual-page-title'],
  ['article', '/plastic-surgery/nose-job-korea/', '.gmc-visual-page-title'],
  ['category', '/plastic-surgery/nose/', '.gmc-page-title'],
  ['blog', '/blog/', '.gmc-page-title'],
  ['gallery', '/bna-gallery/', '.jet-listing-grid__items'],
  ['faq', '/faqs/', '.gmc-page-title'],
  ['partners', '/partners/', '.gmc-title-band h1'],
  ['contact', '/contact/', deployed ? consultationLink : '.gmc-consultation-form form'],
];
const locales = ['/zh/', '/tw/', '/id/', '/ru/', '/th/'];
const screenshots = new Set(['homepage','treatment','article','gallery','contact','faq']);
const errors = [];
const seen = new Map();
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });

async function check(browser, options, label, rows, render) {
  const page = await browser.newPage({ ...options, reducedMotion: 'reduce' });
  try {
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin || !['GET', 'HEAD'].includes(route.request().method())) return route.abort();
      return route.continue();
    });
    for (const [name, path, selector] of rows) {
      const description = `${label} ${name}`;
      try {
        const response = await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
        assert.equal(response?.status(), 200);
        await page.locator('.gmc-header').waitFor({ timeout: 6000 });
        await page.locator(selector).first().waitFor({ timeout: 3000 });
        const canonical = await page.locator('link[rel=canonical]').getAttribute('href');
        assert.equal(new URL(canonical).pathname, path);
        assert.equal(new URL(canonical).origin, indexable ? new URL(base).origin : wordpress);
        if (indexable) assert.doesNotMatch(response?.headers()['x-robots-tag'] || '', /\bnoindex\b/i);
        else assert.equal(response?.headers()['x-robots-tag'], 'noindex, nofollow');
        await page.locator('.gmc-logo img').evaluate(image => image.decode());
        const sizes = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
        assert.ok(sizes[0] <= sizes[1] + 1, `Horizontal overflow ${sizes.join('/')}`);

        if (name === 'homepage' || name === '/ru/') {
          const banner = await page.locator('.gmc-hero img').evaluate(async image => {
            await image.decode();
            const { width, height } = image.getBoundingClientRect();
            return { url: image.currentSrc, natural: image.naturalWidth / image.naturalHeight, visible: width / height };
          });
          const expected = options.viewport.width <= 700 ? 'banner-mobile-3.jpg' : 'banner-3.jpg';
          assert.ok(banner.url.endsWith(expected), 'The original screen-specific banner is used');
          assert.ok(Math.abs(banner.natural - banner.visible) < 0.015, 'The banner keeps its native asset proportions');
          if (label.includes('webkit')) await page.locator('.gmc-skip').focus();
          else await page.keyboard.press('Tab');
          assert.equal(await page.evaluate(() => document.activeElement.className), 'gmc-skip');
          const trigger = page.locator('.gmc-menu-toggle');
          if (await trigger.isVisible()) {
            await trigger.focus();
            await page.keyboard.press('Enter');
            assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
            assert.ok(await page.evaluate(() => document.activeElement.closest('.gmc-nav')));
          }
          const treatments = page.locator('.gmc-treatment-menu > summary');
          await treatments.click();
          const dental = page.locator('.gmc-treatment-group').last().locator('summary');
          await dental.click();
          const firstSubLink = dental.locator('..').locator('a').first();
          assert.ok(await firstSubLink.isVisible());
          assert.ok(new URL(await firstSubLink.getAttribute('href'), base).pathname.endsWith('/dental-veneers/'));
          await page.keyboard.press('Escape');
          assert.equal(await dental.locator('..').getAttribute('open'), null);
          await page.keyboard.press('Escape');
          if (await trigger.isVisible()) {
            await trigger.focus();
            await page.keyboard.press('Escape');
            assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
          }
          assert.equal(await page.locator('.gmc-languages li a').count(), 6);
          if (name === 'homepage') {
            const cards = page.locator('.gmc-treatment-card');
            assert.equal(await cards.count(), 10, 'All ten treatments have accessible links');
            const treatmentPhotos = await cards.evaluateAll(nodes => nodes.map(card => {
              const image = card.querySelector('img');
              const label = card.querySelector('.gmc-treatment-card-label > span');
              return {
                href: card.getAttribute('href'),
                photo: image.getAttribute('src'),
                fit: getComputedStyle(image).objectFit,
                labelFits: label.scrollWidth <= label.clientWidth + 1,
              };
            }));
            assert.ok(treatmentPhotos.every(card => card.href && card.photo && card.fit === 'contain' && card.labelFits));
            const benefitPhotos = await page.locator('.elementor-element-989af5c .elementor-cta__bg-wrapper').evaluateAll(frames => frames.map(frame => {
              const { width, height } = frame.getBoundingClientRect();
              const photo = getComputedStyle(frame.querySelector('.elementor-cta__bg'));
              const radius = getComputedStyle(frame).borderRadius;
              return { width, height, hasImage: photo.backgroundImage !== 'none', fit: photo.backgroundSize, radius, transform: photo.transform };
            }));
            assert.equal(benefitPhotos.length, 4);
            for (const photo of benefitPhotos) {
              assert.ok(photo.hasImage && photo.width > 0 && Math.abs(photo.width - photo.height) <= 1, 'The original square photo has a square frame');
              assert.equal(photo.fit, 'contain', 'The full photo fits the frame');
              assert.equal(photo.radius, '0px', 'The photo corners stay visible');
              assert.equal(photo.transform, 'none', 'The photo keeps its framing without zoom');
            }
            const trigger = page.locator('.gmc-photo-grid .gmc-photo-trigger').first();
            await trigger.focus();
            await page.keyboard.press('Enter');
            const dialog = page.locator('dialog.gmc-photo-dialog[open]');
            await dialog.waitFor({ timeout: 5000 });
            const expected = await trigger.getAttribute('data-photo-src');
            assert.ok((await dialog.locator('img').getAttribute('src')).endsWith(expected));
            await dialog.locator('img').evaluate(img => img.decode());
            await page.keyboard.press('Escape');
            assert.equal(await dialog.count(), 0);
            await page.evaluate(() => {
              document.activeElement?.blur();
              scrollTo(0, 0);
            });
          }
        }

        if (name === 'gallery') {
          const imageSelector = deployed ? '.gmc-collection-tile img' : '.jet-listing-grid__item img';
          const visibleImage = page.locator(`main ${imageSelector}:visible`).first();
          const controls = page.locator('.jet-color-image-list__item');
          const first = await controls.first().boundingBox();
          const second = await controls.nth(1).boundingBox();
          assert.ok(first && second && second.x > first.x, 'Gallery categories share a row');
          const centered = await controls.evaluateAll(labels => labels.every(label => {
            const button = label.querySelector('.jet-color-image-list__button').getBoundingClientRect();
            const image = label.querySelector('img').getBoundingClientRect();
            const frame = label.closest('.jet-color-image-list').getBoundingClientRect();
            return button.left >= frame.left - 1 && button.right <= frame.right + 1 &&
              image.width > 0 && Math.abs(button.left + button.width / 2 - image.left - image.width / 2) < 1;
          }));
          assert.ok(centered, 'Uncropped filter photos are centered inside their cards');
          await visibleImage.scrollIntoViewIfNeeded();
          assert.ok(await visibleImage.evaluate(async image => {
            await image.decode();
            return image.naturalWidth > 0 && image.currentSrc.includes('/wp-content/uploads/');
          }));
          await page.evaluate(() => scrollTo(0, 0));
        }

        if (name === 'faq') {
          const tab = page.locator('.e-n-tabs-heading [role="tab"]').nth(1);
          const panelId = await tab.getAttribute('aria-controls');
          await page.waitForFunction(() => {
            const instances = window.elementorFrontend?.elementsHandler;
            return Boolean(instances && document.querySelector('.e-n-tabs.e-activated'));
          }, { timeout: 6000 });
          if (options.hasTouch) await tab.tap();
          else await tab.click();
          const panel = page.locator('#' + panelId);
          await panel.waitFor({ timeout: 6000 });
          assert.equal(await tab.getAttribute('aria-selected'), 'true');
          const question = panel.locator('details > summary').first();
          const detail = question.locator('..');
          const wasOpen = (await detail.getAttribute('open')) !== null;
          await question.click();
          assert.equal((await detail.getAttribute('open')) !== null, !wasOpen);
          await page.evaluate(() => scrollTo(0, 0));
        }

        if (name === 'contact' && deployed) {
          assert.equal(await page.locator(consultationLink).first().getAttribute('href'), wordpress + path);
          assert.equal(await page.locator('form.elementor-form').count(), 0);
          assert.equal(await page.locator('script[src*="preview-only.js"]').count(), 0);
        } else if (name === 'contact') {
          const field = page.locator('form.elementor-form input[type=email]').first();
          await field.fill('preview@example.test');
          assert.equal(await field.inputValue(), 'preview@example.test');
          const form = page.locator('form.elementor-form');
          await form.evaluate(node => node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
          assert.equal(await page.locator('.gmc-preview-notice').getAttribute('role'), 'status');
          await field.fill('');
          await page.evaluate(() => {
            document.activeElement?.blur();
            scrollTo(0, 0);
          });
        }

        if (render && screenshots.has(name)) {
          await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1800))]));
          const suffix = deployed ? '-release' : '';
          await page.screenshot({ path: `artifacts/${name}-${label}${suffix}.png`, animations: 'disabled', timeout: 15000 });
        }
        seen.set(description, 'pass');
      } catch (error) {
        errors.push(`${description} — ${error.message}`);
      }
    }
  } finally {
    await page.close();
  }
}

async function checkPressFeedback(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    const selectors = ['.gmc-header-cta', '.gmc-treatment-card', '.elementor-cta__button', '.elementor-social-icon'];
    for (const selector of selectors) {
      const control = page.locator(selector + ':visible').first();
      await control.hover();
      assert.equal(await control.evaluate(node => getComputedStyle(node).animationName), 'none');
      await page.mouse.down();
      await page.waitForFunction(selector => {
        const node = Array.from(document.querySelectorAll(selector)).find(el => el.matches(':active'));
        return node && Number(getComputedStyle(node).scale) < .99;
      }, selector, { timeout: 4000 });
      await page.mouse.move(1, 1);
      await page.mouse.up();
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const card = page.locator('.gmc-treatment-card').first();
    await card.hover();
    await page.mouse.down();
    const motion = await card.evaluate(node => {
      const style = getComputedStyle(node);
      return { scale: style.scale, translate: style.translate, duration: style.transitionDuration };
    });
    assert.deepEqual(motion, { scale: '1', translate: 'none', duration: '0s' });
    await page.mouse.move(1, 1);
    await page.mouse.up();
    seen.set('button press feedback', 'pass');
  } catch (error) {
    errors.push(`button press feedback — ${error.message}`);
  } finally {
    await page.close();
  }
}

const chromiumBrowser = await chromium.launch();
const webkitBrowser = await webkit.launch();
try {
  await Promise.all([
    checkPressFeedback(chromiumBrowser),
    check(chromiumBrowser, { viewport: { width: 1440, height: 900 } }, 'chromium-desktop', destinations, true),
    check(webkitBrowser, devices['iPhone 15'], 'webkit-phone', destinations, true),
    check(chromiumBrowser, { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true }, 'chromium-narrow', [...destinations, ...locales.map(path => [path, path, '.gmc-hero h1'])], false),
    check(webkitBrowser, { ...devices['iPhone 15 landscape'] }, 'webkit-landscape', [destinations[0], destinations[1], destinations.at(-1)], false),
  ]);
} finally {
  await Promise.all([chromiumBrowser.close(), webkitBrowser.close()]);
}
console.log(`${seen.size} browser/route combinations passed. ${errors.length} failed.`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
