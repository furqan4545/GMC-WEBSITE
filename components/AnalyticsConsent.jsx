const messages = {
  en: {
    title: 'Website analytics',
    description: 'Optional analytics helps us understand how visitors use this site. It includes masked session recordings on selected public pages. Consultation forms are excluded. You can change your choice any time in Privacy settings.',
    decline: 'Decline analytics',
    allow: 'Allow analytics',
    settings: 'Privacy settings',
    close: 'Close analytics settings',
    enabled: 'Analytics is on.',
    disabled: 'Analytics is off.',
  },
  zh: {
    title: '网站分析',
    description: '可选的网站分析有助于我们了解访客如何使用本网站，包括在部分公开页面记录经过遮蔽的浏览过程。咨询表单不在记录范围内。您可以随时在隐私设置中更改选择。',
    decline: '拒绝分析',
    allow: '允许分析',
    settings: '隐私设置',
    close: '关闭分析设置',
    enabled: '网站分析已开启。',
    disabled: '网站分析已关闭。',
  },
  tw: {
    title: '網站分析',
    description: '選用的網站分析有助於我們了解訪客如何使用本網站，包括在部分公開頁面記錄經過遮蔽的瀏覽過程。諮詢表單不列入記錄。您可以隨時在隱私設定中變更選擇。',
    decline: '拒絕分析',
    allow: '允許分析',
    settings: '隱私設定',
    close: '關閉分析設定',
    enabled: '網站分析已開啟。',
    disabled: '網站分析已關閉。',
  },
  id: {
    title: 'Analitik situs',
    description: 'Analitik opsional membantu kami memahami cara pengunjung menggunakan situs ini. Ini mencakup rekaman sesi yang disamarkan pada halaman publik tertentu. Formulir konsultasi dikecualikan. Anda dapat mengubah pilihan kapan saja di Pengaturan privasi.',
    decline: 'Tolak analitik',
    allow: 'Izinkan analitik',
    settings: 'Pengaturan privasi',
    close: 'Tutup pengaturan analitik',
    enabled: 'Analitik aktif.',
    disabled: 'Analitik nonaktif.',
  },
  th: {
    title: 'การวิเคราะห์เว็บไซต์',
    description: 'การวิเคราะห์เป็นตัวเลือกที่ช่วยให้เราเข้าใจว่าผู้เข้าชมใช้งานเว็บไซต์อย่างไร รวมถึงการบันทึกเซสชันแบบปกปิดข้อมูลในบางหน้าสาธารณะ แบบฟอร์มปรึกษาไม่รวมอยู่ในการบันทึก คุณเปลี่ยนตัวเลือกได้ทุกเมื่อในการตั้งค่าความเป็นส่วนตัว',
    decline: 'ปฏิเสธการวิเคราะห์',
    allow: 'อนุญาตการวิเคราะห์',
    settings: 'การตั้งค่าความเป็นส่วนตัว',
    close: 'ปิดการตั้งค่าการวิเคราะห์',
    enabled: 'เปิดการวิเคราะห์แล้ว',
    disabled: 'ปิดการวิเคราะห์แล้ว',
  },
  ru: {
    title: 'Аналитика сайта',
    description: 'Необязательная аналитика помогает нам понять, как посетители используют сайт. Она включает записи сеансов с маскировкой данных на отдельных общедоступных страницах. Формы консультаций исключены. Вы можете изменить свой выбор в настройках конфиденциальности в любое время.',
    decline: 'Отклонить аналитику',
    allow: 'Разрешить аналитику',
    settings: 'Настройки конфиденциальности',
    close: 'Закрыть настройки аналитики',
    enabled: 'Аналитика включена.',
    disabled: 'Аналитика отключена.',
  },
};

export default function AnalyticsConsent({ locale = 'en' }) {
  const language = typeof locale === 'string' ? locale.toLowerCase().replaceAll('_', '-') : 'en';
  const key = /^(?:tw|zh-(?:tw|hant))(?:-|$)/.test(language) ? 'tw' : language.split('-')[0];
  const copy = messages[key] || messages.en;

  return (
    <div className="gmc-analytics-consent" data-gmc-analytics-consent>
      <div className="gmc-analytics-settings" data-gmc-analytics-settings hidden>
        <button type="button" data-gmc-analytics-open aria-controls="gmc-analytics-prompt" aria-expanded="false">
          {copy.settings}
        </button>
      </div>
      <section
        id="gmc-analytics-prompt"
        className="gmc-analytics-prompt"
        aria-labelledby="gmc-analytics-title"
        aria-describedby="gmc-analytics-description"
        hidden
      >
        <div className="gmc-analytics-prompt-header">
          <h2 id="gmc-analytics-title" tabIndex={-1}>{copy.title}</h2>
          <button type="button" className="gmc-analytics-close" data-gmc-analytics-close aria-label={copy.close} hidden>
            ×
          </button>
        </div>
        <p id="gmc-analytics-description">{copy.description}</p>
        <p className="gmc-analytics-status" aria-live="polite" data-gmc-analytics-status hidden>
          <span data-gmc-analytics-state="granted" hidden>{copy.enabled}</span>
          <span data-gmc-analytics-state="denied" hidden>{copy.disabled}</span>
        </p>
        <div className="gmc-analytics-actions">
          <button type="button" data-gmc-analytics-choice="denied">{copy.decline}</button>
          <button type="button" data-gmc-analytics-choice="granted">{copy.allow}</button>
        </div>
      </section>
    </div>
  );
}
