(() => {
  'use strict';

  const attemptedImages = new WeakMap();

  function recoverImage(image) {
    if (!(image instanceof HTMLImageElement) || image.closest('picture')) return;
    const failed = attemptedImages.get(image) || new Set();
    if (image.currentSrc) failed.add(image.currentSrc);
    if (image.src) failed.add(image.src);
    attemptedImages.set(image, failed);
    const sources = image.dataset.gmcOriginalSrcset || image.getAttribute('srcset') || image.getAttribute('data-srcset') || image.getAttribute('data-lazy-srcset');
    if (!sources) return;
    image.dataset.gmcOriginalSrcset = sources;
    const alternatives = sources.split(',').map(candidate => candidate.trim().split(/\s+/)[0]).filter(Boolean);
    const fallback = alternatives.map(candidate => {
      try {
        const url = new URL(candidate, location.href);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
      } catch {
        return null;
      }
    }).find(candidate => candidate && !failed.has(candidate));
    if (!fallback) return;
    failed.add(fallback);
    image.removeAttribute('srcset');
    image.src = fallback;
  }

  document.addEventListener('error', event => recoverImage(event.target), true);
  for (const image of document.images) {
    if (image.complete && image.currentSrc && !image.naturalWidth) recoverImage(image);
  }

  const copy = {
    en: ['Medical concierge in Seoul', 'We help international patients choose a clinic, plan their visit and get support from the first consultation through aftercare.', 'Free consultation', 'Find a treatment', 'Treatments', 'Menu', 'Close menu', 'Language', 'Skip to content', 'Navigation'],
    zh: ['首尔医疗礼宾服务', '我们帮助国际患者选择诊所、安排赴韩行程，并提供从首次咨询到术后护理的支持。', '免费咨询', '查找治疗项目', '治疗项目', '菜单', '关闭菜单', '语言', '跳至主要内容', '主导航'],
    'zh-TW': ['首爾醫療禮賓服務', '我們協助國際患者選擇診所、安排赴韓行程，並提供從首次諮詢到術後照護的支援。', '免費諮詢', '尋找療程', '療程', '選單', '關閉選單', '語言', '跳至主要內容', '主導覽'],
    id: ['Layanan medis di Seoul', 'Kami membantu pasien internasional memilih klinik, merencanakan kunjungan, dan mendapatkan dukungan dari konsultasi awal hingga perawatan lanjutan.', 'Konsultasi gratis', 'Cari perawatan', 'Perawatan', 'Menu', 'Tutup menu', 'Bahasa', 'Lewati ke konten', 'Navigasi utama'],
    th: ['บริการประสานงานการแพทย์ในโซล', 'เราช่วยผู้ป่วยต่างชาติเลือกคลินิก วางแผนการเดินทาง และดูแลตั้งแต่การปรึกษาครั้งแรกจนถึงหลังการรักษา', 'ปรึกษาฟรี', 'ค้นหาการรักษา', 'การรักษา', 'เมนู', 'ปิดเมนู', 'ภาษา', 'ข้ามไปยังเนื้อหา', 'เมนูหลัก'],
    ru: ['Медицинский консьерж в Сеуле', 'Мы помогаем иностранным пациентам выбрать клинику, спланировать поездку и получить поддержку от первой консультации до восстановления.', 'Бесплатная консультация', 'Выбрать процедуру', 'Процедуры', 'Меню', 'Закрыть меню', 'Язык', 'Перейти к содержанию', 'Основная навигация'],
  };

  const languageNames = { en: 'English', zh: '简体中文', id: 'Bahasa Indonesia', th: 'ภาษาไทย', ru: 'Русский', tw: '繁體中文' };
  const localePath = location.pathname.split('/')[1];
  const locale = localePath === 'tw' ? 'zh-TW' : localePath;
  const [title, introduction, consultation, findTreatment, treatments, menu, closeMenu, language, skip, navigation] = copy[locale] || copy.en;
  const body = document.body;
  const content = document.querySelector('main.site-main, .elementor-location-single, .elementor-location-archive, main');
  const legacy = document.querySelector('header.elementor-location-header');
  if (!content || !legacy || body.classList.contains('elementor-editor-active')) return;

  const element = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const link = (text, href, className = '') => {
    const node = element('a', className, text);
    if (/^(?:https?:\/\/|\/|#)/i.test(href || '')) node.setAttribute('href', href);
    return node;
  };
  const sourceLink = (source, className = '') => link(source.textContent.trim(), source.getAttribute('href'), className);
  const uniqueLinks = (nodes) => {
    const seen = new Set();
    return [...nodes].filter(node => {
      const href = node.getAttribute('href');
      const key = href + '|' + node.textContent.trim();
      if (!href || href === '#' || !node.textContent.trim() || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  for (const image of content.querySelectorAll('img[data-gmc-original-photo]')) {
    image.loading ||= 'lazy';
    for (const attr of ['srcset', 'sizes', 'data-lazy-src', 'data-src', 'data-lazy-srcset', 'data-srcset', 'height']) {
      image.removeAttribute(attr);
    }
    image.src = image.dataset.gmcOriginalPhoto;
  }

  const logo = legacy.querySelector('img.wp-image-18');
  const originalMenu = legacy.querySelector('.jet-mega-menu-list');
  const consult = legacy.querySelector('.elementor-element-175b3f98 a[href]');
  if (!logo || !originalMenu || !consult) return;

  const logoLink = link('', logo.closest('a').getAttribute('href'), 'gmc-logo');
  logoLink.setAttribute('aria-label', 'Gangnam Medical Concierge');
  const logoImage = logo.cloneNode(false);
  logoImage.className = '';
  logoImage.alt = '';
  logoLink.append(logoImage);

  const nav = element('nav', 'gmc-nav');
  nav.id = 'gmc-primary-nav';
  nav.setAttribute('aria-label', navigation);
  const navList = element('ul', 'gmc-nav-list');
  const treatmentSources = [];
  const standaloneSources = [];
  let aboutGroup;
  for (const [index, item] of [...originalMenu.children].entries()) {
    const primary = item.querySelector('.jet-mega-menu-item__inner a[href]');
    if (!primary) continue;
    const submenu = item.querySelector('.jet-mega-menu-mega-container');
    if (index === 0) aboutGroup = { primary, submenu };
    else if (submenu) treatmentSources.push({ primary, submenu });
    else standaloneSources.push(primary);
  }

  function disclosure(label, panel, className = '') {
    const details = element('details', 'gmc-disclosure ' + className);
    const summary = element('summary', 'gmc-nav-action', label);
    details.append(summary, panel);
    details.addEventListener('toggle', () => {
      if (!details.open) return;
      for (const other of nav.querySelectorAll('.gmc-disclosure[open]')) {
        if (other !== details && !other.contains(details) && !details.contains(other)) other.open = false;
      }
    });
    return details;
  }

  function sectionLinks(source) {
    const list = element('ul', 'gmc-sub-list');
    const nodes = source.submenu ? source.submenu.querySelectorAll('a[href]') : [];
    const candidates = uniqueLinks(nodes);
    if (!candidates.some(node => node.getAttribute('href') === source.primary.getAttribute('href'))) {
      candidates.unshift(source.primary);
    }
    for (const entry of candidates) {
      const item = element('li');
      item.append(sourceLink(entry));
      list.append(item);
    }
    return list;
  }

  const addItem = child => {
    const item = element('li');
    item.append(child);
    navList.append(item);
  };
  if (aboutGroup) addItem(disclosure(aboutGroup.primary.textContent.trim(), sectionLinks(aboutGroup), 'gmc-about-menu'));

  if (treatmentSources.length) {
    const menuPanel = element('div', 'gmc-treatment-panel');
    for (const group of treatmentSources) {
      const details = element('details', 'gmc-treatment-group');
      details.append(element('summary', '', group.primary.textContent.trim()), sectionLinks(group));
      menuPanel.append(details);
    }
    addItem(disclosure(treatments, menuPanel, 'gmc-treatment-menu'));
  }
  for (const entry of standaloneSources) addItem(sourceLink(entry, 'gmc-nav-action'));

  const langs = legacy.querySelectorAll('.elementor-element-2599253f .elementor-nav-menu--main li > a[href]');
  if (langs.length) {
    const list = element('ul', 'gmc-sub-list gmc-languages');
    for (const item of langs) {
      const currentPath = new URL(item.href).pathname.split('/')[1];
      const code = Object.hasOwn(languageNames, currentPath) ? currentPath : 'en';
      const entry = element('li');
      const anchor = link(languageNames[code], item.getAttribute('href'));
      anchor.lang = code === 'tw' ? 'zh-TW' : code;
      if ((copy[locale] ? localePath : 'en') === code) anchor.setAttribute('aria-current', 'true');
      const flag = item.querySelector('img');
      if (flag) {
        const image = flag.cloneNode(false);
        image.alt = '';
        anchor.prepend(image);
      }
      entry.append(anchor);
      list.append(entry);
    }
    addItem(disclosure(language, list, 'gmc-language-menu'));
  }
  nav.append(navList);

  const bar = element('div', 'gmc-header-inner wrap');
  const head = element('header', 'gmc-header');
  const cta = link(consultation, consult.getAttribute('href'), 'gmc-button gmc-header-cta');
  const toggle = element('button', 'gmc-menu-toggle', menu);
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', nav.id);
  const mobile = matchMedia('(max-width: 1050px)');
  const setMenu = (open) => {
    const expanded = mobile.matches && open;
    toggle.textContent = expanded ? closeMenu : menu;
    toggle.setAttribute('aria-expanded', String(expanded));
    nav.hidden = mobile.matches && !expanded;
    if (!expanded) {
      for (const detail of nav.querySelectorAll('details[open]')) detail.open = false;
    }
  };
  setMenu(false);
  toggle.addEventListener('click', event => {
    const wasOpen = toggle.getAttribute('aria-expanded') === 'true';
    setMenu(!wasOpen);
    if (!wasOpen && event.detail === 0) nav.querySelector('a, summary')?.focus();
  });
  mobile.addEventListener('change', () => setMenu(false));
  head.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const active = event.target.closest('details[open]');
    if (active) {
      active.open = false;
      active.querySelector('summary').focus();
    } else if (toggle.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      toggle.focus();
    } else {
      const open = nav.querySelector('.gmc-disclosure[open]');
      if (!open) return;
      open.open = false;
      open.querySelector('summary').focus();
    }
    event.preventDefault();
  });
  document.addEventListener('pointerdown', event => {
    if (!head.contains(event.target)) setMenu(false);
  });

  const mainId = content.id || 'gmc-main';
  content.id = mainId;
  if (!content.matches('main,[role="main"]')) content.setAttribute('role', 'main');
  content.tabIndex = -1;
  const skipLink = legacy.parentElement.querySelector(':scope > a.skip-link') || link(skip, '#' + mainId);
  skipLink.className = 'gmc-skip';
  skipLink.href = '#' + mainId;
  skipLink.textContent = skip;
  bar.append(logoLink, nav, cta, toggle);
  head.append(bar);
  legacy.before(skipLink, head);
  legacy.hidden = true;
  body.classList.add('gmc-redesign');

  const isHome = body.classList.contains('home') && content.querySelector('.elementor-element-7fc4561');
  if (isHome) {
    const originalHero = content.querySelector('.elementor-element-d5c6f47');
    const categories = content.querySelector('.elementor-element-7fc4561');
    const campaigns = originalHero ? [...originalHero.querySelectorAll('.jet-listing-grid__item')].map(item => {
      const urls = [...new Set((item.innerHTML.match(/(?:https?:\/\/gangnammedicalconcierge\.com)?\/wp-content\/uploads\/[^"'\s()<>]+\.(?:jpe?g|webp|png)/gi) || []))];
      return { desktop: urls.find(url => !url.includes('-mobile-')), mobile: urls.find(url => url.includes('-mobile-')) };
    }).filter(campaign => campaign.desktop) : [];
    if (campaigns.length && originalHero) {
      const hero = element('section', 'gmc-hero hero wrap');
      hero.dataset.enter = 'hero';
      hero.setAttribute('aria-labelledby', 'gmc-home-title');
      const words = element('div', 'gmc-hero-copy');
      const kicker = element('p', 'gmc-kicker', 'Gangnam Medical Concierge');
      const heading = element('h1', '', title);
      heading.id = 'gmc-home-title';
      const actions = element('div', 'gmc-hero-actions');
      categories.id ||= 'gmc-treatments';
      actions.append(link(consultation, consult.getAttribute('href'), 'gmc-button'), link(findTreatment, '#' + categories.id, 'gmc-button gmc-button-secondary'));
      words.append(kicker, heading, element('p', 'gmc-intro', introduction), actions);
      function campaignPicture(campaign, heroImage = false) {
        const picture = element('picture');
        if (campaign.mobile) {
          const source = element('source');
          source.media = '(max-width: 700px)';
          source.srcset = campaign.mobile;
          source.width = 680;
          source.height = 1200;
          picture.append(source);
        }
        const image = element('img');
        image.src = campaign.desktop;
        image.width = 2560;
        image.height = 1440;
        image.lang = 'en';
        image.alt = heroImage ? 'More than 200 Korean clinic partners' : 'Happy patients, skilled doctors';
        if (heroImage) image.fetchPriority = 'high';
        else image.loading = 'lazy';
        picture.append(image);
        return picture;
      }
      const visual = element('figure', 'gmc-hero-visual');
      visual.append(campaignPicture(campaigns[0], true));
      hero.append(words, visual);
      originalHero.before(hero);

      if (campaigns.length > 1) {
        const banners = element('div', 'gmc-campaigns');
        for (const campaign of campaigns.slice(1)) {
          banners.append(campaignPicture(campaign));
        }
        originalHero.parentElement.append(banners);
      }
      originalHero.hidden = true;

      const verified = content.querySelector('.elementor-element-ec053e9');
      if (verified) {
        verified.dataset.moment = 'picture-develops';
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
          const observer = new IntersectionObserver(entries => {
            if (!entries.some(entry => entry.isIntersecting)) return;
            verified.classList.add('gmc-photo-arrived');
            observer.disconnect();
          }, { threshold: 0.2 });
          observer.observe(verified);
        }
      }
    }
  }

  if (isHome) {
    const categories = content.querySelector('.elementor-element-7fc4561');
    const original = categories.querySelector(':scope > .e-con-inner');
    const entries = original ? [...original.querySelectorAll('.jet-listing-grid__item')] : [];
    const grid = element('ul', 'gmc-treatment-grid');

    for (const entry of entries) {
      const label = entry.querySelector('.elementor-heading-title')?.textContent.trim();
      const originalLink = entry.querySelector('.jet-engine-listing-overlay-link[href]');
      const originalPhoto = entry.querySelector('img');
      if (!label || !originalLink || !originalPhoto) continue;

      const item = element('li');
      const card = link('', originalLink.getAttribute('href'), 'gmc-treatment-card');
      const media = element('span', 'gmc-treatment-photo');
      const photo = originalPhoto.cloneNode(false);
      photo.alt = '';
      photo.loading = 'lazy';
      media.append(photo);
      const text = element('span', 'gmc-treatment-card-label');
      text.append(element('span', '', label), element('span', 'gmc-treatment-arrow'));
      card.append(media, text);
      item.append(card);
      grid.append(item);
    }

    if (entries.length && grid.children.length === entries.length) {
      original.hidden = true;
      categories.append(element('h2', 'gmc-section-title', treatments), grid);
    }
  }

  if (isHome && 'HTMLDialogElement' in window) {
    const photoLabel = { en: 'Open photo', zh: '查看照片', tw: '查看照片', id: 'Buka foto', th: 'เปิดรูปภาพ', ru: 'Открыть фото' }[localePath] || 'Open photo';
    const closeLabel = { en: 'Close photo', zh: '关闭照片', tw: '關閉照片', id: 'Tutup foto', th: 'ปิดรูปภาพ', ru: 'Закрыть фото' }[localePath] || 'Close photo';
    const originalGallery = content.querySelector('.elementor-element-b9970ee .jet-listing-grid');
    if (originalGallery) {
      const gallery = element('div', 'gmc-photo-grid');
      const seen = new Set();
      for (const item of originalGallery.querySelectorAll('.jet-listing-grid__item')) {
        const image = item.querySelector('img');
        const href = image?.getAttribute('data-lazy-src') || image?.getAttribute('src');
        if (!href || !/^https?:\/\/|^\//i.test(href) || seen.has(href)) continue;
        seen.add(href);
        const trigger = element('button', 'gmc-photo-trigger');
        trigger.type = 'button';
        trigger.dataset.photoSrc = href;
        const caption = item.querySelector('.elementor-widget-text-editor')?.textContent.trim();
        trigger.setAttribute('aria-label', caption ? `${photoLabel}. ${caption}` : photoLabel);
        const thumbnail = image.cloneNode(false);
        thumbnail.alt = '';
        thumbnail.loading = 'lazy';
        trigger.append(thumbnail);
        const figure = element('figure', 'gmc-photo-item');
        figure.append(trigger);
        if (caption) figure.append(element('figcaption', '', caption));
        gallery.append(figure);
      }
      if (gallery.childElementCount) {
        originalGallery.before(gallery);
        originalGallery.hidden = true;
      }
      const dialog = element('dialog', 'gmc-photo-dialog');
      const close = element('button', 'gmc-photo-close', '×');
      const photo = element('img');
      dialog.setAttribute('aria-label', photoLabel);
      close.type = 'button';
      close.setAttribute('aria-label', closeLabel);
      close.addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', event => {
        if (event.target === dialog) dialog.close();
      });
      let opener;
      dialog.addEventListener('close', () => {
        opener?.focus({ preventScroll: true });
        photo.removeAttribute('src');
      });
      dialog.append(close, photo);
      body.append(dialog);

      gallery.addEventListener('click', event => {
        const trigger = event.target.closest('button.gmc-photo-trigger');
        if (!trigger || dialog.open) return;
        opener = trigger;
        photo.src = trigger.dataset.photoSrc;
        photo.alt = photoLabel;
        dialog.showModal();
        close.focus();
      });
    }
  }

  if (isHome) {
    const originalReviews = content.querySelector('.ti-widget.ti-goog');
    const reviews = originalReviews?.querySelectorAll('.ti-reviews-container-wrapper > .ti-review-item');
    if (reviews?.length) {
      const section = element('div', 'gmc-reviews wrap');
      const logo = originalReviews.querySelector('.ti-widget-container .ti-large-logo img');
      const rating = originalReviews.querySelector('.ti-rating-text');
      if (logo || rating) {
        const summary = element('div', 'gmc-review-summary');
        if (logo) summary.append(logo.cloneNode(false));
        if (rating) summary.append(element('p', '', rating.textContent.replace(/\s+/g, ' ').trim()));
        section.append(summary);
      }
      const grid = element('div', 'gmc-review-grid');
      for (const review of reviews) {
        const card = element('article', 'gmc-review');
        const identity = element('div', 'gmc-review-author');
        const image = review.querySelector('.ti-profile-img img');
        const author = review.querySelector('.ti-name');
        if (image) identity.append(image.cloneNode(false));
        if (author) identity.append(element('strong', '', author.textContent.trim()));
        const stars = element('div', 'gmc-review-stars');
        for (const star of review.querySelectorAll('.ti-star')) stars.append(star.cloneNode(false));
        const reviewText = review.querySelector('.ti-review-content');
        card.append(identity, stars);
        if (reviewText?.textContent.trim()) card.append(element('p', '', reviewText.textContent.trim()));
        grid.append(card);
      }
      section.append(grid);
      originalReviews.before(section);
      originalReviews.hidden = true;
    }
  }

  if (isHome) {
    const story = content.querySelector('.elementor-element-a6107b6 > .e-con-inner');
    const intro = story?.querySelector(':scope > .elementor-element-0c97c1e');
    const storyCopy = intro?.querySelector('.elementor-element-0d6372a');
    const storyPhoto = intro?.querySelector('.elementor-element-ec053e9');
    const supporting = story?.querySelector(':scope > .elementor-element-b57f79f');
    const journeyTitle = story?.querySelector(':scope > .elementor-element-358dddf');
    const steps = story?.querySelectorAll(':scope > .elementor-widget-icon-box');
    if (storyCopy && storyPhoto && supporting && journeyTitle && steps.length) {
      const feature = element('div', 'gmc-story-feature');
      const media = element('div', 'gmc-story-photos');
      media.append(storyPhoto, supporting);
      feature.append(storyCopy, media);
      story.prepend(feature);
      intro.remove();

      const journey = element('div', 'gmc-journey');
      const grid = element('div', 'gmc-journey-grid');
      grid.append(...steps);
      journey.append(journeyTitle, grid);
      story.append(journey);
    }

    const testimonials = content.querySelector('.elementor-element-d6489ba');
    const images = new Map();
    for (const item of testimonials?.querySelectorAll('.jet-listing-grid__item') || []) {
      const photo = item.querySelector('img');
      if (photo && item.dataset.postId) images.set(item.dataset.postId, photo);
    }
    if (images.size) {
      const grid = element('div', 'gmc-testimonial-photos');
      for (const picture of images.values()) {
        const frame = element('figure');
        const photo = picture.cloneNode(false);
        photo.loading = 'lazy';
        photo.src = picture.dataset.lazySrc || picture.dataset.src || picture.src;
        for (const attr of ['data-lazy-src', 'data-src', 'data-ll-status']) photo.removeAttribute(attr);
        photo.classList.remove('entered', 'lazyloading', 'lazyloaded');
        frame.append(photo);
        grid.append(frame);
      }
      testimonials.before(grid);
      testimonials.hidden = true;
    }
  }

  function pageTitle() {
    const label = document.querySelector('meta[property="og:title"]')?.content || document.title;
    return label.replace(/\s+[—–]\s+Gangnam Medical Concierge$/i, '').trim();
  }

  function promoteHeading(original, level = 'h1') {
    if (original.tagName.toLowerCase() === level) return original;
    const heading = element(level);
    for (const attr of original.attributes) heading.setAttribute(attr.name, attr.value);
    heading.append(...original.childNodes);
    original.replaceWith(heading);
    return heading;
  }

  if (!isHome) {
    const firstSection = content.querySelector('.e-parent');
    const topHeading = content.querySelector('h1, h2');
    const plainTitlePage = body.matches('.page-id-50, .page-id-52, .page-id-46');
    const titlePage = body.matches('.page-id-549, .page-id-56, .archive');
    const isArticle = content.classList.contains('elementor-location-single') && body.classList.contains('single-post');
    const firstIsMedia = firstSection
      && firstSection.getAttribute('data-settings')?.includes('background_background')
      && !firstSection.querySelector('h1, h2, p, a, form')
      && !firstSection.textContent.trim();

    content.classList.add('gmc-inner-page');
    if (plainTitlePage && topHeading && firstSection?.contains(topHeading)) {
      promoteHeading(topHeading).classList.add('gmc-masthead-title');
      firstSection.classList.add('gmc-title-band');
    } else if (topHeading && firstIsMedia) {
      const originalWrapper = topHeading.closest('.elementor-widget-theme-post-title');
      const heading = promoteHeading(topHeading);
      heading.classList.add('gmc-page-title', 'gmc-visual-page-title');

      if (isArticle) {
        const masthead = element('header', 'gmc-editorial-masthead');
        const breadcrumb = content.querySelector('.rank-math-breadcrumb');
        if (breadcrumb) masthead.append(breadcrumb);
        masthead.append(heading);
        const metadata = element('div', 'gmc-article-meta');
        const terms = content.querySelector('.elementor-element-ef0a64b');
        const date = content.querySelector('.elementor-element-c67a286');
        if (terms) metadata.append(terms);
        if (date) metadata.append(date);
        if (metadata.childElementCount) masthead.append(metadata);
        firstSection.before(masthead);
        content.classList.add('gmc-article-page');
      } else {
        firstSection.before(heading);
        content.classList.add('gmc-treatment-page');
      }
      if (originalWrapper && !originalWrapper.textContent.trim()) originalWrapper.remove();
    } else if (titlePage && !content.querySelector('h1') && pageTitle()) {
      content.prepend(element('h1', 'gmc-page-title', pageTitle()));
    } else if (topHeading && !content.querySelector('h1')) {
      promoteHeading(topHeading).classList.add('gmc-masthead-title');
    }

    const blogCategories = content.querySelector('.elementor-element-9d37328');
    const blogLinks = uniqueLinks(blogCategories?.querySelectorAll('a[href]') || []);
    if (blogLinks.length) {
      const rail = element('nav', 'gmc-blog-categories');
      rail.setAttribute('aria-label', navigation);
      for (const item of blogLinks) rail.append(sourceLink(item));
      blogCategories.before(rail);
      blogCategories.hidden = true;
    }
  }

  for (const photo of content.querySelectorAll('.jet-slider img[data-lazy-src]')) {
    photo.loading = 'lazy';
    photo.src = photo.dataset.lazySrc;
    photo.removeAttribute('data-lazy-src');
  }

  const footer = document.querySelector('.elementor-location-footer');
  const closing = footer?.querySelector('.elementor-element-9064875');
  if (closing) closing.append(link(consultation, consult.getAttribute('href'), 'gmc-button gmc-footer-cta'));

  const photoBackgrounds = content.querySelectorAll(
    '.elementor-element[data-settings*="background_background"], [style*="background-image"], .elementor-carousel-image'
  );
  const photoSources = new WeakMap();
  const rasterBackground = /url\(["']?([^"')]+\.(?:avif|gif|jpe?g|png|webp)(?:[?#][^"')]+)?)["']?\)/i;

  function fitPhotoBackgrounds() {
    for (const frame of photoBackgrounds) {
      if (frame.closest('[hidden]')) continue;
      const source = getComputedStyle(frame).backgroundImage;
      const overlay = getComputedStyle(frame, '::before').backgroundImage;
      const backgroundUrl = source.match(rasterBackground)?.[1];
      const overlayUrl = overlay.match(rasterBackground)?.[1];
      const photoUrl = backgroundUrl || overlayUrl;
      frame.classList.toggle('gmc-photo-background', Boolean(backgroundUrl));
      frame.classList.toggle('gmc-photo-background-before', Boolean(overlayUrl));
      if (!photoUrl) continue;

      const isImagePanel = frame.classList.contains('e-con') &&
        !frame.textContent.trim() && !frame.querySelector('.elementor-widget, img, video, iframe');
      if (!isImagePanel || photoSources.get(frame) === photoUrl) continue;

      frame.classList.add('gmc-photo-panel');
      photoSources.set(frame, photoUrl);
      const photo = new Image();
      photo.onload = () => {
        if (photoSources.get(frame) === photoUrl && photo.naturalHeight) {
          frame.style.setProperty('--gmc-photo-ratio', `${photo.naturalWidth} / ${photo.naturalHeight}`);
        }
      };
      photo.src = photoUrl;
    }
  }

  fitPhotoBackgrounds();
  body.classList.add('gmc-layout-ready');
  window.addEventListener('load', fitPhotoBackgrounds, { once: true });
  let resizeFrame;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(fitPhotoBackgrounds);
  }, { passive: true });

  const form = content.querySelector('.elementor-form');
  if (form) form.closest('.elementor-widget-form')?.classList.add('gmc-consultation-form');
})();
