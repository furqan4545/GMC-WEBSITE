const uploads = '/wp-content/uploads/';
const currentLogo = '2025/08/gangnam-medical-concierge-plastic-surgery-agency-korea-logo.svg';
const recoveredLogos = new Map([
  ['2025/10/GMC-Logo-Full-alt-colorway-12.png', currentLogo],
  ['2025/11/GMC-Logo-Full-alt-colorway-5.png', currentLogo],
  ['2025/11/GMC-Logo-Full-alt-colorway-6.png', currentLogo],
  ['2026/01/GMC-Logo-Full-alt-colorway.png', currentLogo],
  ['2026/01/GMC-Logo-Full-alt-colorway-1.png', currentLogo],
  ['2026/06/GMC-Logo-Full-alt-colorway.png', '2026/06/GMC-Logo-Full-alt-colorway.png.webp'],
  ['2026/08/GMC-Logo-Full-alt-colorway-1-7.png', '2026/11/GMC-Logo-Full-alt-colorway-1-7-edited.png'],
  ['2026/08/GMC-Logo-Full-alt-colorway-1-10.png', currentLogo],
  ['https://evpq67uj435.exactdn.com/wp-content/uploads/2026/06/gangnam-medical-concierge-plastic-surgery-agency-korea-logo-1.svg',
    '2026/06/gangnam-medical-concierge-plastic-surgery-agency-korea-logo-1.svg'],
]);

const clinicImageOriginals = new Map([
  ['https://abplasticsurgerykorea.com/_next/image?url=%2Fimages%2Fbreast%2Flanding%2FbodyType%2F05.png&w=2048&q=90',
    'https://abplasticsurgerykorea.com/images/breast/landing/bodyType/05.png'],
  ['https://abplasticsurgerykorea.com/_next/image?url=%2Fimages%2Fnose%2Fimplant-free-rhinoplasty%2Fvisual%2Fimg01_en.png&w=2048&q=90',
    'https://abplasticsurgerykorea.com/images/nose/implant-free-rhinoplasty/visual/img01_en.png'],
]);

export function repairEditorialMedia($) {
  for (const node of $('body img[data-lazy-src]').toArray()) {
    const image = $(node);
    const original = image.attr('data-lazy-src');
    const clinicImage = clinicImageOriginals.get(original);
    if (clinicImage) {
      image.next('noscript').remove();
      image.removeAttr('data-lazy-src').attr({ src: clinicImage, loading: 'lazy' });
      continue;
    }

    const key = original.startsWith(uploads) ? original.slice(uploads.length) : original;
    const replacement = recoveredLogos.get(key);
    if (!replacement) continue;

    image.next('noscript').remove();
    image.removeAttr('data-lazy-src').attr({
      src: uploads + replacement,
      alt: 'Gangnam Medical Concierge',
      loading: 'lazy',
    }).addClass('gmc-article-logo');
  }

  // These three public originals were never downloaded into the copy.
  for (const node of $('img:is(.wp-image-2577, .wp-image-2578, .wp-image-2579)[data-lazy-src^="/wp-content/uploads/2025/07/screenshot-2025-07-13-214"]').toArray()) {
    const image = $(node);
    image.attr('data-lazy-src', 'https://gangnammedicalconcierge.com' + image.attr('data-lazy-src'));
  }
}

export function enableNativeMedia($) {
  for (const node of $('body img[data-lazy-src]').toArray()) {
    const image = $(node);
    const deferredSource = image.attr('data-lazy-src');
    const fallback = image.next('noscript');
    const fallbackMarkup = fallback.html() || '';
    const embeddedSource = !deferredSource
      ? fallbackMarkup.match(/^\s*<img\b[^>]*\ssrc="(data:image\/jpeg;base64,[A-Za-z0-9+/=]+)"[^>]*>\s*$/i)?.[1]
      : null;
    const source = embeddedSource || deferredSource;
    if (!embeddedSource && !/^(?:\/(?!\/)|https?:\/\/)/i.test(source)) continue;

    for (const name of ['srcset', 'sizes']) {
      const value = image.attr('data-lazy-' + name);
      if (value) image.attr(name, value);
      image.removeAttr('data-lazy-' + name);
    }
    image.attr('src', source).removeAttr('data-lazy-src');
    if (!image.attr('loading') && image.attr('fetchpriority') !== 'high') image.attr('loading', 'lazy');

    if (/^\s*<img\b[^>]*>\s*$/i.test(fallbackMarkup)) fallback.remove();
  }

  const embeds = [
    '.elementor-location-footer iframe[src="about:blank"][data-lazy-src^="https://maps.google.com/maps?"]',
    'iframe.wp-embedded-content[src="about:blank"][data-lazy-src^="https://gangnammedicalconcierge.com/"]',
  ];
  for (const node of $(embeds.join(',')).toArray()) {
    const frame = $(node);
    const source = frame.attr('data-lazy-src');
    if (frame.hasClass('wp-embedded-content') && !new URL(source).pathname.endsWith('/embed/')) continue;

    frame.attr('src', source).removeAttr('data-lazy-src').removeAttr('data-rocket-lazyload');
    if (frame.attr('style') === 'position:absolute;visibility:hidden') frame.removeAttr('style');
  }
}
