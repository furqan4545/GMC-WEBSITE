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

  let photoDialog;
  function openPhoto(entry) {
    if (!photoDialog) {
      photoDialog = element('dialog', 'gmc-collection-photo');
      photoDialog.setAttribute('aria-label', viewPhoto);
      const dismiss = element('button', 'gmc-collection-dismiss', close);
      dismiss.type = 'button';
      dismiss.addEventListener('click', () => photoDialog.close());
      photoDialog.append(dismiss, element('img'));
      document.body.append(photoDialog);
    }
    const image = photoDialog.querySelector('img');
    image.alt = entry.alt;
    image.src = entry.image;
    photoDialog.showModal();
  }

  function galleryCard(entry) {
    const card = element('button', 'gmc-collection-tile');
    card.type = 'button';
    card.setAttribute('aria-label', entry.alt ? `${viewPhoto} ${entry.alt}` : viewPhoto);
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
    if (gallery) gallery.classList.add('gmc-collection-gallery');
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
      grid.replaceChildren(...(cards.length ? cards : [element('p', 'gmc-collection-empty', noPhotos)]));

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
