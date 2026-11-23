(() => {
  const notices = {
    en: 'Preview only. Use sample details. This form does not send a consultation request.',
    zh: '仅供预览。请使用示例资料。此表单不会发送咨询请求。',
    tw: '僅供預覽。請使用範例資料。此表單不會傳送諮詢請求。',
    id: 'Pratinjau saja. Gunakan data contoh. Formulir ini tidak mengirim permintaan konsultasi.',
    th: 'สำหรับการแสดงตัวอย่างเท่านั้น โปรดใช้ข้อมูลตัวอย่าง แบบฟอร์มนี้จะไม่ส่งคำขอปรึกษา',
    ru: 'Предварительный просмотр. Используйте вымышленные данные. Эта форма не отправляет заявку.',
  };
  const message = notices[location.pathname.split('/')[1]] || notices.en;
  for (const form of document.querySelectorAll('form.elementor-form')) {
    const notice = document.createElement('p');
    notice.className = 'gmc-preview-notice';
    notice.textContent = message;
    form.before(notice);
    form.addEventListener('submit', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      notice.setAttribute('role', 'status');
      notice.tabIndex = -1;
      notice.focus();
    }, true);
  }
})();
