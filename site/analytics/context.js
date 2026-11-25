const locales = new Set(['zh', 'tw', 'id', 'th', 'ru']);
const companyPages = new Set(['services', 'care-team', 'partners', 'best-price-guarantee', 'gmc-verification-process']);
const treatmentCategories = new Set(['plastic-surgery', 'aesthetics', 'vision-correction', 'dental-aesthetics']);
const searchOrigins = new Map([
  ['google.com', 'google'], ['bing.com', 'bing'], ['search.yahoo.com', 'yahoo'],
  ['duckduckgo.com', 'duckduckgo'], ['baidu.com', 'baidu'], ['naver.com', 'naver'], ['yandex.ru', 'yandex'],
]);
const socialOrigins = new Map([
  ['facebook.com', 'facebook'], ['instagram.com', 'instagram'], ['tiktok.com', 'tiktok'],
  ['youtube.com', 'youtube'], ['reddit.com', 'reddit'], ['threads.net', 'threads'],
  ['linkedin.com', 'linkedin'], ['x.com', 'x'], ['t.co', 'x'], ['xiaohongshu.com', 'xiaohongshu'],
  ['t.me', 'telegram'], ['line.me', 'line'], ['whatsapp.com', 'whatsapp'],
]);
const campaignPlatforms = new Set([...searchOrigins.values(), ...socialOrigins.values(), 'newsletter', 'partner']);
const campaignMedia = new Set(['cpc', 'ppc', 'paid_search', 'organic', 'social', 'paid_social', 'email', 'referral', 'display', 'affiliate']);
const contactOrigins = new Map([
  ['wa.me', 'whatsapp'], ['whatsapp.com', 'whatsapp'], ['line.me', 'line'], ['lin.ee', 'line'],
  ['t.me', 'telegram'], ['kakao.com', 'kakao'], ['instagram.com', 'instagram'],
  ['xiaohongshu.com', 'xiaohongshu'], ['tiktok.com', 'tiktok'],
]);

export function pageContext(pathname, body) {
  const route = pathname.split('/').filter(Boolean);
  const locale = locales.has(route[0]) ? route.shift() : 'en';
  const [page] = route;
  const prefix = locale === 'en' ? '/' : `/${locale}/`;
  if (!page) return { locale, surface: 'home', path: prefix, replay: true };
  if (page === 'contact') return { locale, surface: 'contact', path: prefix + 'contact/' };
  if (page === 'faqs') return { locale, surface: 'faq', path: prefix + 'faqs/', replay: true };
  if (page === 'bna-gallery') return { locale, surface: 'gallery', path: prefix + 'bna-gallery/' };
  if (companyPages.has(page)) return { locale, surface: 'company', path: prefix + page + '/', replay: route.length === 1 };
  if (body.classList.contains('single-post')) return { locale, surface: 'article', path: prefix + 'articles/' };
  if (page === 'blog' || page === 'all-blog-posts' || body.classList.contains('category')) {
    return { locale, surface: 'blog', path: prefix + 'blog/' };
  }
  if (treatmentCategories.has(page) || body.classList.contains('page')) {
    return { locale, surface: 'treatment', path: prefix + 'treatments/' };
  }
  return { locale, surface: 'other', path: prefix + 'other/' };
}

function knownHost(hostname, origins) {
  for (const [domain, source] of origins) {
    if (hostname === domain || hostname.endsWith('.' + domain)) return [domain, source];
  }
  return [];
}

export function trafficSource(url, referrer) {
  const medium = url.searchParams.get('utm_medium')?.toLowerCase();
  const platform = url.searchParams.get('utm_source')?.toLowerCase();
  let referral;
  try { referral = new URL(referrer); } catch { /* Direct traffic has no referrer. */ }
  if (referral?.origin === url.origin) return null;
  const hostname = referral?.hostname || '';
  const [searchDomain, search] = knownHost(hostname, searchOrigins);
  const [socialDomain, social] = knownHost(hostname, socialOrigins);
  const paidSearch = ['cpc', 'ppc', 'paid_search'].includes(medium);
  const source = campaignPlatforms.has(platform) ? platform : search || social || (hostname ? 'other' : 'direct');
  const channel = paidSearch ? 'paid_search' : medium === 'paid_social' ? 'paid_social'
    : campaignMedia.has(medium) && medium !== 'organic' ? medium
      : search || medium === 'organic' ? 'organic_search' : social ? 'social' : hostname ? 'referral' : 'direct';
  const domain = searchDomain || socialDomain;
  return {
    traffic_source: source,
    traffic_channel: channel,
    ...(domain ? { $referrer: `https://${domain}/`, $referring_domain: domain } : {}),
    ...(campaignPlatforms.has(platform) ? { utm_source: platform } : {}),
    ...(campaignMedia.has(medium) ? { utm_medium: medium } : {}),
  };
}

function destination(anchor, origin) {
  if (!anchor?.href) return null;
  try { return new URL(anchor.href, origin); } catch { return null; }
}

function contactMethod(url) {
  if (url.protocol === 'tel:') return 'phone';
  if (url.protocol === 'mailto:') return 'email';
  return knownHost(url.hostname, contactOrigins)[1];
}

function placement(control) {
  if (control.closest('.gmc-header')) return 'header';
  if (control.closest('.gmc-hero')) return 'hero';
  if (control.closest('footer, .elementor-location-footer')) return 'footer';
  return 'content';
}

export const clickEvents = new Set([
  'consultation_clicked', 'consultation_handoff_clicked', 'contact_channel_clicked', 'language_selected',
  'treatment_clicked', 'faq_topic_selected', 'faq_answer_opened', 'gallery_filter_selected', 'gallery_photo_opened',
  'collection_paginated', 'article_link_clicked', 'article_share_clicked', 'site_navigation_clicked',
]);

export function interaction(control, url, context) {
  const event = (name, properties = {}) => [name, { placement: placement(control), ...properties }];
  if (control.closest('[data-gmc-analytics-consent], [contenteditable], textarea, input:not([type="radio"])')) return null;
  const anchor = control.closest('a[href]');
  const target = destination(anchor, url.origin);
  if (anchor?.closest('.gmc-languages')) {
    const code = anchor.lang === 'zh-TW' ? 'tw' : anchor.lang;
    if (code === 'en' || locales.has(code)) return event('language_selected', { destination_locale: code });
  }
  if (target && /^\/(?:(?:zh|tw|id|th|ru)\/)?contact\/$/.test(target.pathname)) {
    if (target.origin === url.origin) return event('consultation_clicked');
    if (target.hostname === 'gangnammedicalconcierge.com') return event('consultation_handoff_clicked');
  }
  if (control.closest('.gmc-treatment-group a, .gmc-treatment-card, .gmc-hero-actions a[href^="#"]')) {
    return event('treatment_clicked');
  }
  if (context.surface === 'faq') {
    if (control.closest('[role="tab"], .e-n-tab-title')) return event('faq_topic_selected');
    const summary = control.closest('details.e-n-accordion-item > summary');
    if (summary && !summary.parentElement.open) return event('faq_answer_opened');
  }
  if (control.closest('.gmc-collection-tile, .gmc-photo-trigger')) return event('gallery_photo_opened');
  if (control.closest('.gmc-collection-pages a, .gmc-collection-pages button')) return event('collection_paginated');
  if (control.closest('.elementor-share-btn')) return event('article_share_clicked');
  if (target && (context.surface === 'contact' || control.closest('.elementor-location-footer, .gmc-contact'))) {
    const channel = contactMethod(target);
    if (channel) return event('contact_channel_clicked', { contact_channel: channel });
  }
  for (const [source, selector] of [
    ['related', '.gmc-related a'], ['contents', '.wp-block-rank-math-toc-block a'],
    ['archive', '.elementor-posts-container a, .elementor-post a'],
  ]) {
    if (control.closest(selector)) return event('article_link_clicked', { article_placement: source });
  }
  if (anchor?.closest('.gmc-nav')) return event('site_navigation_clicked');
  return null;
}
