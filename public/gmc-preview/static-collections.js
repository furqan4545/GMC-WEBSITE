(() => {
  const archive = document.querySelector('.elementor-widget-archive-posts .elementor-posts-container');
  const gallery = document.querySelector('#list-2 .jet-listing-grid__items');
  const originalPager = document.querySelector('.jet-filters-pagination');
  if (!(archive || gallery) || !originalPager) return;

  const copy = {
    en: ['Pages', 'Previous', 'Next', 'View photo', 'Close', 'No photos in this category.'],
    zh: ['页码', '上一页', '下一页', '查看照片', '关闭', '此类别没有照片。'],
    tw: ['頁碼', '上一頁', '下一頁', '查看照片', '關閉', '此類別沒有照片。'],
    id: ['Halaman', 'Sebelumnya', 'Berikutnya', 'Lihat foto', 'Tutup', 'Tidak ada foto dalam kategori ini.'],
    ru: ['Страницы', 'Назад', 'Вперёд', 'Открыть фото', 'Закрыть', 'В этой категории нет фотографий.'],
    th: ['หน้า', 'ก่อนหน้า', 'ถัดไป', 'ดูรูปภาพ', 'ปิด', 'ไม่มีรูปภาพในหมวดหมู่นี้'],
  };
  const pathLanguage = location.pathname.split('/')[1];
  const language = Object.hasOwn(copy, pathLanguage) ? pathLanguage : 'en';
  const [pages, previous, next, viewPhoto, close, noPhotos] = copy[language];
  const number = new Intl.NumberFormat(document.documentElement.lang || language);
  const provider = gallery ? 'jet-engine:list-2' : 'epro-archive';
  const grid = gallery || archive;
  const categoryInputs = gallery ? [...document.querySelectorAll('.jet-color-image-list__input[name="category"]')] : [];
  const categoryInputsByValue = new Map(categoryInputs.map(input => [input.value, input]));
  const originalCards = archive ? [...archive.querySelectorAll('article.elementor-post')] : [];
  const originalCardIds = new Map(originalCards.flatMap(card => {
    const match = /\bpost-(\d+)\b/.exec(card.className);
    return match ? [[match[1], card]] : [];
  }));
  const category = [...document.body.classList].find(name => /^category-(?!\d+$)[\w-]+$/.test(name))?.slice(9);

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function photo(source, alt) {
    const image = element('img');
    image.alt = alt;
    image.src = source;
    image.decoding = 'async';
    image.loading = 'lazy';
    return image;
  }

  const caseTitles = new Map();

  function imageSource(image) {
    return image?.dataset.lazySrc || image?.dataset.src || image?.getAttribute('src');
  }

  function eagerPhoto(image) {
    if (!image) return;
    image.loading = 'eager';
    const source = imageSource(image);
    if (source && source !== image.getAttribute('src')) image.src = source;
    const sources = image.dataset.lazySrcset || image.dataset.srcset;
    if (sources) image.srcset = sources;
    delete image.dataset.lazySrc;
    delete image.dataset.src;
    delete image.dataset.lazySrcset;
    delete image.dataset.srcset;
  }

  function photoPath(value) {
    if (!value) return null;
    const path = new URL(value, location.href).pathname;
    return path.startsWith('/wp-content/uploads/') ? path : null;
  }

  function renderFeaturedGallery(entries) {
    const featured = document.querySelector('#list-1');
    const featuredSection = featured?.closest('.elementor-element-b551a02');
    if (!featuredSection) return;

    const available = new Map(entries.map(entry => [photoPath(entry.image), entry]));
    const initialPhotos = new Map([...gallery.querySelectorAll(':scope > [data-post-id]')].map(card => [
      card.dataset.postId,
      photoPath(imageSource(card.querySelector('img'))),
    ]));
    const cards = [...featured.querySelectorAll('.jet-listing-grid__item[data-post-id]:not(.swiper-slide-duplicate)')];
    const featuredWrap = featuredSection.querySelector(':scope > .e-con-inner');
    const grid = element('ul', 'gmc-gallery-featured');
    let covered = cards.length > 0 && featuredWrap?.children.length === 1;
    grid.id = featured.id;
    for (const card of cards) {
      const images = [...card.querySelectorAll('img')];
      const paths = images.map(image => photoPath(imageSource(image)));
      if (!paths.length) paths.push(initialPhotos.get(card.dataset.postId));
      const unique = [...new Set(paths)];
      const title = card.querySelector('.elementor-widget-text-editor')?.textContent.trim();
      if (title) for (const path of unique.filter(Boolean)) caseTitles.set(path, title);
      if (unique.some(path => !path || !available.has(path)) || card.querySelector('a[href], audio, video, iframe, picture source')) {
        covered = false;
        continue;
      }
      for (const path of unique) {
        const item = element('li');
        item.append(galleryCard(available.get(path)));
        grid.append(item);
      }
    }
    if (covered) featured.replaceWith(grid);
  }

  let photoDialog;
  function openPhoto(entry) {
    if (!photoDialog) {
      photoDialog = element('dialog', 'gmc-collection-photo');
      const header = element('div', 'gmc-collection-photo-header');
      const title = element('h2', 'gmc-collection-photo-title');
      const dismiss = element('button', 'gmc-collection-dismiss', close);
      dismiss.type = 'button';
      dismiss.addEventListener('click', () => photoDialog.close());
      header.append(title, dismiss);
      photoDialog.append(header, element('img'));
      document.body.append(photoDialog);
    }
    const title = caseTitles.get(photoPath(entry.image));
    const heading = photoDialog.querySelector('h2');
    heading.textContent = title || '';
    heading.hidden = !title;
    photoDialog.setAttribute('aria-label', title || viewPhoto);
    const image = photoDialog.querySelector('img');
    image.alt = entry.alt;
    image.src = entry.image;
    photoDialog.showModal();
  }

  function galleryCard(entry) {
    const card = element('button', 'gmc-collection-tile');
    card.type = 'button';
    const label = caseTitles.get(photoPath(entry.image)) || entry.alt;
    card.setAttribute('aria-label', label ? `${viewPhoto} ${label}` : viewPhoto);
    const image = photo(entry.image, entry.alt);
    if (entry.width && entry.height) {
      image.width = entry.width;
      image.height = entry.height;
    }
    card.append(image);
    card.addEventListener('click', () => openPhoto(entry));
    return card;
  }

  function articleCard(entry) {
    if (originalCardIds.has(entry.id)) return originalCardIds.get(entry.id);
    const card = element('article', 'elementor-post elementor-grid-item');
    card.setAttribute('role', 'listitem');
    if (entry.image) {
      const coverLink = element('a', 'elementor-post__thumbnail__link');
      coverLink.href = entry.route;
      coverLink.tabIndex = -1;
      coverLink.setAttribute('aria-hidden', 'true');
      const thumbnail = element('div', 'elementor-post__thumbnail');
      thumbnail.append(photo(entry.image, ''));
      coverLink.append(thumbnail);
      card.append(coverLink);
    }
    const description = element('div', 'elementor-post__text');
    const title = element('h3', 'elementor-post__title');
    const link = element('a', '', entry.title);
    link.href = entry.route;
    title.append(link);
    description.append(title);
    card.append(description);
    return card;
  }

  function dataUrl(page, selected) {
    const url = new URL(location.href);
    if (page > 1 || selected !== 'all') url.searchParams.set('jsf', provider);
    else if (url.searchParams.get('jsf') === provider) url.searchParams.delete('jsf');
    if (page > 1) url.searchParams.set('pagenum', String(page));
    else url.searchParams.delete('pagenum');
    if (selected !== 'all') url.searchParams.set('tax', `category:${selected}`);
    else if (gallery) url.searchParams.delete('tax');
    return url;
  }

  async function initialize() {
    if (gallery) {
      for (const image of document.querySelectorAll('.jet-color-image-list__decorator img')) {
        eagerPhoto(image);
      }
    }
    const data = await fetch(`/gmc-preview/collections/${gallery ? 'gallery' : language}.json`);
    if (!data.ok) return;
    let entries = await data.json();
    if (!gallery) {
      if (category) entries = entries.filter(entry => entry.categories.includes(category));
      const originalIds = [...originalCardIds.keys()];
      const byOriginalPosition = new Map(originalIds.map((id, position) => [id, position]));
      entries.sort((left, right) => (byOriginalPosition.get(left.id) ?? Infinity) - (byOriginalPosition.get(right.id) ?? Infinity) || 0);
    }
    if (!entries.length) return;

    const pager = element('nav', 'gmc-collection-pages');
    pager.setAttribute('aria-label', pages);
    originalPager.replaceWith(pager);
    if (gallery) {
      renderFeaturedGallery(entries);
      gallery.classList.add('gmc-collection-gallery');
      document.body.classList.add('gmc-gallery-ready');
    }
    grid.tabIndex = -1;

    function navigate(page, selected, focusGrid) {
      const url = dataUrl(page, selected);
      if (url.href !== location.href) history.pushState(null, '', url);
      render();
      if (focusGrid) {
        grid.focus({ preventScroll: true });
        grid.scrollIntoView({ block: 'start' });
      }
    }

    function paginationLink(label, page, selected, current = false) {
      const link = element('a', '', label);
      link.href = dataUrl(page, selected);
      if (current) link.setAttribute('aria-current', 'page');
      link.addEventListener('click', event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(page, selected, true);
      });
      return link;
    }

    function render() {
      const query = new URLSearchParams(location.search);
      const requestedCategory = /^category:(\d+)$/.exec(query.get('tax') || '')?.[1];
      const selected = categoryInputsByValue.has(requestedCategory) ? requestedCategory : 'all';
      const filtered = selected === 'all' ? entries : entries.filter(entry => entry.categories.includes(selected));
      for (const input of categoryInputs) input.checked = input.value === selected;
      const step = gallery ? 6 : 12;
      const firstStep = gallery ? step : Math.max(step, originalCards.length);
      const lastPage = Math.max(1, Math.ceil((filtered.length - firstStep) / step) + 1);
      const requestedPage = Number(query.get('pagenum') || 1);
      const page = Number.isSafeInteger(requestedPage) ? Math.min(lastPage, Math.max(1, requestedPage)) : 1;
      const start = page === 1 ? 0 : firstStep + (page - 2) * step;
      const end = start + (page === 1 ? firstStep : step);
      const cards = filtered.slice(start, end).map(gallery ? galleryCard : articleCard);
      if (archive && !gallery) {
        for (const card of cards.slice(0, 3)) eagerPhoto(card.querySelector('img'));
      }
      if (cards.length) grid.replaceChildren(...cards);
      else {
        const message = element('p', 'gmc-collection-empty', noPhotos);
        message.setAttribute('role', 'status');
        grid.replaceChildren(message);
      }

      pager.replaceChildren();
      pager.hidden = lastPage <= 1;
      if (lastPage <= 1) return;
      if (page > 1) pager.append(paginationLink(previous, page - 1, selected));
      const candidates = [...new Set([1, page - 1, page, page + 1, lastPage])].filter(value => value >= 1 && value <= lastPage);
      let priorNumber = 0;
      for (const candidate of candidates) {
        if (candidate > priorNumber + 1) pager.append(element('span', 'gmc-collection-ellipsis', '…'));
        pager.append(paginationLink(number.format(candidate), candidate, selected, candidate === page));
        priorNumber = candidate;
      }
      if (page < lastPage) pager.append(paginationLink(next, page + 1, selected));
    }

    for (const input of categoryInputs) input.addEventListener('change', () => navigate(1, input.value, false));
    addEventListener('popstate', render);
    render();
  }

  initialize().catch(error => console.error('Could not load the site collection.', error));
})();
