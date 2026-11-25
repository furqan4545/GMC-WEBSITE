(() => {
  const root = document.querySelector('[data-gmc-analytics-consent]');
  if (!root || root.dataset.ready) return;
  const tracker = document.querySelector('[data-gmc-analytics-host]');
  if (tracker && tracker.dataset.gmcAnalyticsHost !== location.host) return;
  root.dataset.ready = 'true';

  const key = 'gmc-analytics-consent';
  const prompt = root.querySelector('#gmc-analytics-prompt');
  const title = root.querySelector('#gmc-analytics-title');
  const settings = root.querySelector('[data-gmc-analytics-open]');
  const settingsRow = root.querySelector('[data-gmc-analytics-settings]');
  const close = root.querySelector('[data-gmc-analytics-close]');
  const status = root.querySelector('[data-gmc-analytics-status]');
  const states = root.querySelectorAll('[data-gmc-analytics-state]');

  function readChoice() {
    try {
      const saved = window.localStorage.getItem(key);
      return saved === 'granted' || saved === 'denied' ? saved : null;
    } catch {
      return null;
    }
  }

  let choice = readChoice();
  let openedFromSettings = false;

  function notify(value) {
    window.dispatchEvent(new CustomEvent('gmc:analytics-consent', { detail: value }));
  }

  function updateStatus() {
    for (const state of states) state.hidden = state.dataset.gmcAnalyticsState !== choice;
    status.hidden = !choice;
  }

  function setOpen(open) {
    prompt.hidden = !open;
    close.hidden = !openedFromSettings;
    settings.setAttribute('aria-expanded', String(open));
  }

  function dismiss() {
    const restoreFocus = openedFromSettings;
    openedFromSettings = false;
    setOpen(false);
    if (restoreFocus) settings.focus({ preventScroll: true });
  }

  settingsRow.hidden = false;
  updateStatus();
  setOpen(!choice);

  settings.addEventListener('click', () => {
    openedFromSettings = true;
    setOpen(true);
    title.focus();
  });
  close.addEventListener('click', dismiss);
  prompt.addEventListener('keydown', event => {
    if (event.key === 'Escape' && openedFromSettings) {
      event.preventDefault();
      dismiss();
    }
  });

  for (const button of root.querySelectorAll('[data-gmc-analytics-choice]')) {
    button.addEventListener('click', () => {
      const next = button.dataset.gmcAnalyticsChoice;
      if (next !== 'granted' && next !== 'denied') return;
      const changed = choice !== next;
      choice = next;
      try {
        window.localStorage.setItem(key, choice);
      } catch {
        // The explicit choice still applies to this page if storage is unavailable.
      }
      if (changed) notify(choice);
      updateStatus();
      dismiss();
    });
  }

  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    const next = readChoice();
    if (next === choice) return;
    choice = next;
    notify(choice ?? 'denied');
    updateStatus();
    if (!openedFromSettings) setOpen(!choice);
  });
})();
