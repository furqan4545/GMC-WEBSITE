import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { load } from 'cheerio';
import { captureFaqCopy } from '../lib/faq-localization.js';

const { values } = parseArgs({ options: { url: { type: 'string' } } });
const base = values.url ? new URL(values.url) : undefined;
const original = 'https://gangnammedicalconcierge.com';
const variants = [
  ['en', 'en', 'FAQs'],
  ['zh', 'zh', '常见问题'],
  ['tw', 'zh-TW', '常見問題'],
  ['id', 'id', 'Pertanyaan Umum'],
  ['th', 'th', 'คำถามที่พบบ่อย'],
  ['ru', 'ru', 'Часто задаваемые вопросы'],
];
const content = new URL('../content/faq-localization/', import.meta.url);
const build = new URL('../.next/server/pages/', import.meta.url);
const paths = variants.map(([locale]) => locale === 'en' ? '/faqs/' : `/${locale}/faqs/`);
const english = JSON.parse(await readFile(new URL('en.json', content), 'utf8'));

async function readPage(path) {
  if (!base) return readFile(new URL(path.slice(1, -1) + '.html', build), 'utf8');
  const response = await fetch(new URL(path, base), {
    redirect: 'manual',
    signal: AbortSignal.timeout(12000),
  });
  assert.equal(response.status, 200, `${path} (${response.headers.get('x-vercel-mitigated') || 'HTTP status'})`);
  assert.match(response.headers.get('content-type') || '', /^text\/html/i, path);
  return response.text();
}

for (const [index, [locale, lang, title]] of variants.entries()) {
  if (base && index) await delay(1800);
  const path = paths[index];
  const $ = load(await readPage(path));
  const expected = JSON.parse(await readFile(new URL(`${locale}.json`, content), 'utf8'));
  const actual = captureFaqCopy($);
  assert.equal($('html').attr('lang'), lang, path);
  assert.equal($('main h1').first().text().trim(), title, path);
  assert.equal($('head link[rel="canonical"]').attr('href'), original + path, path);
  const alternates = $('head link[rel="alternate"][hreflang]').toArray().map(link => new URL($(link).attr('href')).pathname);
  for (const alternate of paths) assert.ok(alternates.includes(alternate), `${path} alternate ${alternate}`);

  for (const [group, count] of [['tabs', 9], ['headings', 22], ['questions', 90], ['answers', 90]]) {
    assert.equal(Object.keys(actual[group]).length, count, `${path} ${group}`);
    assert.deepEqual(actual[group], expected[group], `${path} ${group}`);
    if (locale === 'en' || !['questions', 'answers'].includes(group)) continue;
    for (const [id, text] of Object.entries(actual[group])) {
      assert.notDeepEqual(text, english[group][id], `${path} ${group} ${id} still uses the English copy`);
    }
  }
  console.log(`${path} ${lang} passed. 9 tabs, 22 headings, 90 questions, 90 answers, canonical and all alternates.`);
}
