const recommendationLabels = {
  en: 'Related articles',
  zh: '相关文章',
  tw: '相關文章',
  id: 'Artikel terkait',
  th: 'บทความที่เกี่ยวข้อง',
  ru: 'Похожие статьи',
};

// The original WordPress English aliases redirect to these exact canonical paths.
// Their five translated aliases return 404, while the localized canonical pages exist.
const localizedLegacyDestinations = new Map([
  ['fractional-laser-therapy', '/aesthetics/lifting-tightening/fractional-laser-therapy/'],
  ['thread-lifting-non-surgical', '/aesthetics/lifting-tightening/thread-lifting-non-surgical/'],
  ['korean-rhinoplasty-guide', '/plastic-surgery/nose/korean-rhinoplasty-guide/'],
  ['korea-facelift-2025-natural', '/plastic-surgery/face-lift/korea-facelift-2025-natural/'],
  ['consultation', '/contact/'],
  ['5-trending-cosmetic-procedures-in-korea', '/plastic-surgery/5-trending-cosmetic-procedures-in-korea/'],
  ['thigh-lift-surgery', '/plastic-surgery/body-contouring/thigh-lift-surgery/'],
  ['our-services', '/services/'],
  ['nose-surgery-korea-rhinoplasty', '/rhinoplasty/'],
  ['breast-augmentation-korea', '/plastic-surgery/breast/breast-augmentation-korea/'],
  ['brow-lift-7-amazing-benefits', '/plastic-surgery/face-lift/brow-lift-7-amazing-benefits/'],
  ['face-lift-in-korea-2025-edition', '/plastic-surgery/face-lift/face-lift-in-korea-2025-edition/'],
  ['mini-facelift-korea', '/mini-facelift/'],
  ['smas-face-lift-surgery-korea', '/full-face-lift-surgery/'],
  ['facelift-korea-vs-other-countries', '/plastic-surgery/face-lift/facelift-korea-vs-other-countries/'],
  ['gmc-services-will-transform-your-trip', '/plastic-surgery/gmc-services-will-transform-your-trip/'],
  ['double-jaw-surgery-7-benefits', '/plastic-surgery/jaw/double-jaw-surgery-7-benefits/'],
  ['before-after', '/bna-gallery/'],
  ['skin-and-dermatology-guide', '/skin-dermatology-treatments/'],
  ['korean-skin-boosters', '/skin-boosters/'],
  ['plastic-surgery-recovery-korea', '/plastic-surgery/nose/korean-rhinoplasty-guide/'],
  ['rhinoplasty-7-benefits', '/plastic-surgery/nose/rhinoplasty-7-benefits/'],
  ['rhinoplasty-recovery-korea-tips', '/plastic-surgery/nose/rhinoplasty-recovery-korea-tips/'],
  ['why-choose-gmc-korea', '/plastic-surgery/why-choose-gmc-korea/'],
  ['local-cafes-korea-hidden-gems', '/travel/must-eats/local-cafes-korea-hidden-gems/'],
]);

function webUrl(value) {
  return /^(?:\/(?!\/)|https?:\/\/)/i.test(value || '') ? value : '';
}

export function repairEditorialLinks($, pathname) {
  $('a[href="mailto:%20info@doctorv.co.uk"]').attr('href', 'mailto:info@doctorv.co.uk');

  for (const node of $('a[href^="https://gangnammedicalconcierge.com/"]').toArray()) {
    const anchor = $(node);
    const url = new URL(anchor.attr('href'));
    const alias = /^\/(zh|tw|id|th|ru)\/([^/]+)\/?$/.exec(url.pathname);
    const destination = alias && localizedLegacyDestinations.get(alias[2]);
    if (destination) anchor.attr('href', '/' + alias[1] + destination + url.search + url.hash);
  }

  const recoveryArticle = /^(\/(?:zh|tw|id|th|ru))?\/plastic-surgery\/nose\/rhinoplasty-recovery-korea-tips\/$/.exec(pathname);
  if (recoveryArticle && !$('[id="comments"], a[name="comments"]').length) {
    const href = recoveryArticle[1] ? pathname + '#comments'
      : 'https://gangnammedicalconcierge.com/rhinoplasty-recovery-korea-tips/#comments';
    $('body.single-post .elementor-widget-theme-post-content .wp-block-list > li > a[href="' + href + '"]')
      .filter((_, node) => $(node).text().trim() === 'Comments' && $(node).parent().children().length === 1)
      .parent().remove();
  }

  const partnerPlaceholders = $('body.page-id-52 [data-widget_type="jet-brands.default"] .brands-list__item > a.brands-list__item-link[href="#"]');
  for (const node of partnerPlaceholders.toArray()) {
    const anchor = $(node);
    const wrapper = $('<div></div>').attr('class', anchor.attr('class'));
    anchor.replaceWith(wrapper.append(anchor.contents()));
  }

  const skip = $('a.skip-link[href="#content"]');
  if (skip.length && !$('[id="content"]').length) {
    const main = $('main.site-main, .elementor-location-single, .elementor-location-archive, main').first();
    if (main.length) {
      const id = main.attr('id') || 'content';
      main.attr({ id, tabindex: '-1' });
      if (!main.is('main,[role="main"]')) main.attr('role', 'main');
      skip.attr('href', '#' + id);
    }
  }

  const doubleEyelidArticle = /^(\/(?:zh|tw|id|th|ru))?\/plastic-surgery\/eyes\/double-eyelid-surgery\/$/.exec(pathname);
  if (!doubleEyelidArticle) return;

  const treatment = (doubleEyelidArticle[1] || '') + '/double-eyelid-surgery/';
  const article = $('body.single-post .elementor-widget-theme-post-content');
  const ids = new Set(article.find('[id]').map((_, node) => $(node).attr('id')).get());
  for (const node of article.find('a[href^="' + treatment + '#"]').toArray()) {
    const anchor = $(node);
    const fragment = anchor.attr('href').slice(treatment.length);
    if (ids.has(fragment.slice(1))) anchor.attr('href', fragment);
  }
}

function removeEmptyEditorialBlocks($) {
  const widgets = $('body.single-post .elementor-widget-theme-post-content');
  for (const widget of widgets.toArray()) {
    const container = $(widget).children('.elementor-widget-container').first();
    const content = container.length ? container : $(widget);
    for (const node of content.children('p, h1, h2, h3, h4, h5, h6, br').toArray()) {
      const block = $(node);
      const visibleContent = block.text().replace(/\u200B/g, '').trim() ||
        block.find('img, picture, video, audio, iframe, svg, canvas, embed, object, a[href], [role]').length;
      if (visibleContent) continue;
      if (block.is('[id], [name]') || block.find('[id], [name]').length) block.addClass('gmc-article-anchor');
      else block.remove();
    }
  }
}

function articleFromCard($, element) {
  const card = $(element);
  const link = card.find('.elementor-image-box-title a[href]').first();
  const title = link.text().replace(/\s+/g, ' ').trim();
  const href = webUrl(link.attr('href'));
  if (!title || !href) return null;
  const photo = card.find('.elementor-image-box-img img').first();
  const image = [photo.attr('data-gmc-original-photo'), photo.attr('data-lazy-src'), photo.attr('src')]
    .map(webUrl).find(Boolean) || '';
  return { title, href, image };
}

export function prepareEditorial($, pathname) {
  repairEditorialLinks($, pathname);
  removeEmptyEditorialBlocks($);
  // Elementor expects the answer region directly inside the accordion item.
  $('details.e-n-accordion-item > b > .e-con[role="region"]').unwrap('b');
  const locale = pathname.split('/')[1];
  const title = recommendationLabels[locale] || recommendationLabels.en;
  const recommendations = [];
  for (const node of $('body:not(.page-id-549) .elementor-widget-loop-carousel').toArray()) {
    const carousel = $(node);
    const sourceCards = carousel.find('.swiper-wrapper > .e-loop-item').toArray();
    if (!sourceCards.length) {
      if (!carousel.find('a[href], img, video, iframe').length) carousel.remove();
      continue;
    }
    const cards = sourceCards.map(card => articleFromCard($, card));
    if (cards.some(card => !card)) continue;
    const articles = [...new Map(cards.map(card => [card.href, card])).values()];
    const section = carousel.closest('body.single-post .elementor-element-f26b132');
    const slot = section.length ? section : carousel;
    slot.replaceWith($('<div></div>').attr('data-gmc-recommendations', String(recommendations.length)));
    recommendations.push({ title: section.length ? title : '', articles });
  }
  return recommendations;
}
