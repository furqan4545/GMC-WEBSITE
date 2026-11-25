import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localizeFaqSeo } from './faq-seo.js';

const groups = {
  tabs: ['.e-n-tab-title-text', '.e-n-tab-title', 'id'],
  headings: ['.elementor-widget-heading .elementor-heading-title', '.elementor-widget-heading', 'data-id'],
  questions: ['.e-n-accordion-item-title-text', 'details.e-n-accordion-item', 'id'],
  answers: ['details.e-n-accordion-item [role="region"]', 'details.e-n-accordion-item', 'id'],
};

const mainSelector = 'main.site-main, .elementor-location-single, .elementor-location-archive, main';
const faqOrigin = 'https://gangnammedicalconcierge.com';

function textNodes(element) {
  return element.children.flatMap(child => {
    if (child.type === 'text') return child.data.trim() ? [child] : [];
    if (child.type !== 'tag') return [];
    return textNodes(child);
  });
}

function units($) {
  const main = $(mainSelector).first();
  return Object.fromEntries(Object.entries(groups).map(([group, [selector, parent, attribute]]) => {
    const entries = new Map();
    for (const element of main.find(selector).toArray()) {
      const item = $(element);
      if (group === 'headings' && item.closest('details.e-n-accordion-item').length) continue;
      const key = item.closest(parent).attr(attribute);
      const segments = textNodes(element);
      if (!key || !segments.length || entries.has(key)) {
        throw new Error(`Unexpected FAQ structure for ${group} entry ${key ?? '(without an ID)'}`);
      }
      entries.set(key, { element, segments });
    }
    return [group, entries];
  }));
}

export function captureFaqCopy($) {
  return Object.fromEntries(Object.entries(units($)).map(([group, entries]) =>
    [group, Object.fromEntries([...entries].map(([key, { segments }]) => [key, segments.map(node => node.data.trim())]))]));
}

function prepareRichAnswer($, element, entry) {
  if (!entry || !/^[a-z0-9]+$/.test(entry.widget) || typeof entry.html !== 'string') {
    throw new Error('Invalid rich FAQ answer');
  }
  const widget = $(element).find(`.elementor-widget-text-editor[data-id="${entry.widget}"]`);
  const container = widget.children('.elementor-widget-container');
  const target = container.length ? container : widget;
  if (target.length !== 1 || target.find('img, svg, picture, iframe, video, audio, object, embed').length) {
    throw new Error(`FAQ answer widget ${entry.widget} cannot be replaced safely`);
  }
  const incoming = $('<div></div>').html(entry.html);
  const allowed = new Set(['p', 'strong', 'b', 'em', 'i', 'br', 'a']);
  for (const node of incoming.find('*').toArray()) {
    if (!allowed.has(node.name) ||
        Object.keys(node.attribs).some(name => node.name !== 'a' || name !== 'href')) {
      throw new Error(`Unexpected markup in FAQ answer widget ${entry.widget}`);
    }
  }
  const originalLinks = target.find('a[href]').toArray();
  const authoredLinks = incoming.find('a').toArray();
  if (originalLinks.length !== authoredLinks.length) throw new Error(`Unexpected link change in FAQ answer widget ${entry.widget}`);
  for (const [index, node] of authoredLinks.entries()) {
    const original = $(originalLinks[index]);
    const authored = new URL($(node).attr('href'), faqOrigin);
    const existing = new URL(original.attr('href'), faqOrigin);
    if (authored.origin !== existing.origin || authored.pathname.replace(/^\/tw\//, '/') !== existing.pathname.replace(/^\/tw\//, '/')) {
      throw new Error(`Unexpected link destination in FAQ answer widget ${entry.widget}`);
    }
    $(node).attr({ ...original.attr(), href: authored.pathname + authored.search + authored.hash });
  }
  return [target, incoming.html()];
}

export function mergeFaqCopy($, translation) {
  const updates = [];
  const richUpdates = [];
  for (const [group, entries] of Object.entries(units($))) {
    const copy = translation[group];
    if (!copy || Object.keys(copy).length !== entries.size) throw new Error(`Incomplete FAQ translation group ${group}`);
    for (const [key, { element, segments: nodes }] of entries) {
      const segments = copy[key];
      if (!Array.isArray(segments) || segments.some(segment => typeof segment !== 'string' || !segment.trim())) {
        throw new Error(`Invalid FAQ translation for ${group} entry ${key}`);
      }
      const rich = group === 'answers' && translation.richAnswers?.[key];
      if (rich) {
        richUpdates.push(prepareRichAnswer($, element, rich));
        continue;
      }
      if (segments.length !== nodes.length) throw new Error(`Invalid number of FAQ segments for ${group} entry ${key}`);
      for (const [index, node] of nodes.entries()) {
        const leading = node.data.match(/^\s*/u)[0];
        const trailing = node.data.match(/\s*$/u)[0];
        updates.push([node, leading + segments[index].trim() + trailing]);
      }
    }
  }
  for (const [node, text] of updates) node.data = text;
  for (const [target, markup] of richUpdates) target.html(markup);
}

export async function localizeFaq($, pathname) {
  const copy = localizeFaqSeo($, pathname);
  if (!copy) return;
  const { locale, label } = copy;
  if (locale !== 'en') {
    const file = resolve(process.cwd(), 'content', 'faq-localization', locale + '.json');
    try {
      mergeFaqCopy($, JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
      throw new Error(`FAQ content for ${pathname}: ${error.message}`, { cause: error });
    }
  }
  const main = $(mainSelector).first();
  const heading = main.find('h1').first();
  if (heading.length) heading.text(label);
  else main.prepend($('<h1></h1>').addClass('gmc-page-title').text(label));
}
