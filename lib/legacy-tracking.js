import { load } from 'cheerio';

const originalOrigin = 'https://gangnammedicalconcierge.com';
const tagManagerHosts = new Set(['googletagmanager.com', 'www.googletagmanager.com']);
const captchaHosts = new Set(['google.com', 'www.google.com', 'recaptcha.net', 'www.recaptcha.net']);
const scriptSources = ['src', 'data-src', 'data-rocket-src'];
const frameSources = ['src', 'data-src', 'data-lazy-src', 'data-rocket-src'];

function urlMatches(element, attributes, matches) {
  return attributes.some(attribute => {
    const value = element.attr(attribute);
    if (!value || !URL.canParse(value, originalOrigin)) return false;
    const url = new URL(value, originalOrigin);
    return (url.protocol === 'https:' || url.protocol === 'http:') && matches(url);
  });
}

function removeTagManagerFrames($) {
  const frames = $('iframe').filter((_, node) => urlMatches($(node), frameSources,
    url => tagManagerHosts.has(url.hostname) && url.pathname === '/ns.html'));
  frames.remove();
  return frames.length;
}

function removeTagManagerFallbacks($) {
  for (const node of $('noscript').toArray()) {
    const fallback = $(node);
    const markup = fallback.html() || '';
    if (!markup.toLowerCase().includes('googletagmanager.com')) continue;
    // The HTML parser leaves the content of body noscript tags as text.
    const fragment = load(markup, { scriptingEnabled: false }, false);
    if (!removeTagManagerFrames(fragment)) continue;
    if (fragment.root().children().length || fragment.root().text().trim()) fallback.html(fragment.html());
    else fallback.remove();
  }
}

export function removeLegacyTracking($) {
  const formUsesCaptcha = $('form:not(.jet-color-image-list-wrapper), .g-recaptcha, .elementor-g-recaptcha, [data-sitekey], [name="g-recaptcha-response"]').length > 0;
  $('link[rel~="dns-prefetch"], link[rel~="preconnect"], link[rel~="preload"]')
    .filter((_, node) => urlMatches($(node), ['href'], url => tagManagerHosts.has(url.hostname)))
    .remove();

  $('script').filter((_, node) => urlMatches($(node), scriptSources, url => {
    if (url.hostname === 'static.cloudflareinsights.com' && /^\/beacon\.min\.js(?:\/|$)/.test(url.pathname)) return true;
    return !formUsesCaptcha && captchaHosts.has(url.hostname) && /^\/recaptcha\/(?:api|enterprise)\.js$/.test(url.pathname);
  })).remove();

  removeTagManagerFrames($);
  removeTagManagerFallbacks($);
}
