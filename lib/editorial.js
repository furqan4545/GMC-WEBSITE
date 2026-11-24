const recommendationLabels = {
  en: ['Related articles', 'More articles'],
  zh: ['相关文章', '更多文章'],
  tw: ['相關文章', '更多文章'],
  id: ['Artikel terkait', 'Artikel lainnya'],
  th: ['บทความที่เกี่ยวข้อง', 'บทความเพิ่มเติม'],
  ru: ['Похожие статьи', 'Другие статьи'],
};

function webUrl(value) {
  return /^(?:\/(?!\/)|https?:\/\/)/i.test(value || '') ? value : '';
}

export function repairEditorialLinks($, pathname) {
  $('a[href="mailto:%20info@doctorv.co.uk"]').attr('href', 'mailto:info@doctorv.co.uk');

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
  const [title, moreLabel] = recommendationLabels[locale] || recommendationLabels.en;
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
    recommendations.push({ title: section.length ? title : '', moreLabel, articles });
  }
  return recommendations;
}
