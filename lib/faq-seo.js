const faqCopy = {
  en: {
    label: 'FAQs',
    description: 'Answers to common questions about arranging surgery in Korea, Gangnam Medical Concierge services, choosing a clinic, treatment options, and recovery.',
  },
  zh: {
    label: '常见问题',
    description: '了解在韩国安排手术的常见问题，包括 Gangnam Medical Concierge 的服务、诊所选择、治疗项目和术后恢复。',
  },
  tw: {
    label: '常見問題',
    description: '查看在韓國安排手術的常見問題，包括 Gangnam Medical Concierge 的服務、診所選擇、療程選項和術後恢復。',
  },
  id: {
    label: 'Pertanyaan Umum',
    description: 'Jawaban atas pertanyaan umum tentang operasi di Korea, layanan Gangnam Medical Concierge, pilihan klinik dan perawatan, serta pemulihan.',
  },
  th: {
    label: 'คำถามที่พบบ่อย',
    description: 'คำตอบสำหรับคำถามเกี่ยวกับการวางแผนผ่าตัดในเกาหลี บริการของ Gangnam Medical Concierge การเลือกคลินิก ทางเลือกในการรักษา และการพักฟื้น',
  },
  ru: {
    label: 'Часто задаваемые вопросы',
    description: 'Ответы на вопросы об операциях в Корее, услугах Gangnam Medical Concierge, выборе клиники, вариантах процедур и восстановлении.',
  },
};

export function localizeFaqSeo($, pathname) {
  const match = /^\/(?:(zh|tw|id|th|ru)\/)?faqs\/$/.exec(pathname);
  if (!match) return;

  const locale = match[1] || 'en';
  const { label, description } = faqCopy[locale];
  const title = `${label} — Gangnam Medical Concierge`;
  const head = $('head');
  head.find('title').text(title);
  head.find('meta[property="og:title"], meta[name="twitter:title"]').attr('content', title);
  head.find('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]').attr('content', description);

  const canonical = head.find('link[rel="canonical"]').attr('href');
  const schema = head.find('script.rank-math-schema[type="application/ld+json"]').first();
  if (canonical && schema.length) {
    const graph = JSON.parse(schema.html());
    for (const node of graph['@graph'] ?? []) {
      if (node['@id'] === canonical + '#webpage' || node['@id'] === canonical + '#richSnippet') {
        if (Object.hasOwn(node, 'name')) node.name = title;
        if (Object.hasOwn(node, 'headline')) node.headline = title;
        if (Object.hasOwn(node, 'description')) node.description = description;
      }
      if (node['@id'] === canonical + '#breadcrumb') {
        const crumb = node.itemListElement?.find(entry => entry.item?.['@id'] === canonical);
        if (crumb?.item.name) crumb.item.name = label;
      }
    }
    schema.text(JSON.stringify(graph).replaceAll('<', '\\u003c'));
  }

  return { locale, label };
}
