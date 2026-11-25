import { interaction, pageContext, trafficSource } from './context.js';

const marker = document.querySelector('[data-gmc-analytics-token]');
const consentKey = 'gmc-analytics-consent';
const attributionKey = 'gmc-analytics-attribution';
const privacySignal = () => navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1';

function savedConsent() {
  try { return localStorage.getItem(consentKey) === 'granted'; } catch { return false; }
}

function attribution(url) {
  const current = trafficSource(url, document.referrer);
  try {
    const saved = Number(sessionStorage.getItem(`${attributionKey}-time`));
    const previous = sessionStorage.getItem(attributionKey);
    if (!current && previous && Date.now() - saved < 30 * 60 * 1000) {
      // Reclassify stored values instead of merging browser storage into the event.
      const parsed = JSON.parse(previous);
      const campaignUrl = new URL(url.origin);
      if (parsed.utm_source) campaignUrl.searchParams.set('utm_source', parsed.utm_source);
      if (parsed.utm_medium) campaignUrl.searchParams.set('utm_medium', parsed.utm_medium);
      const previousSource = trafficSource(campaignUrl, parsed.$referrer || '');
      // Unknown external referrers are represented by a fixed bucket, never a hostname.
      if (parsed.traffic_source === 'other' && previousSource.traffic_source === 'direct') {
        previousSource.traffic_source = 'other';
        previousSource.traffic_channel = 'referral';
      }
      sessionStorage.setItem(`${attributionKey}-time`, String(Date.now()));
      return previousSource;
    }
    if (current) sessionStorage.setItem(attributionKey, JSON.stringify(current));
    sessionStorage.setItem(`${attributionKey}-time`, String(Date.now()));
  } catch { /* Tracking also works without session storage. */ }
  return current ?? { traffic_source: 'direct', traffic_channel: 'direct' };
}

if (marker?.dataset.gmcAnalyticsHost === location.host && !privacySignal()) {
  const url = new URL(location.href);
  const context = pageContext(url.pathname, document.body);
  let consent = false;
  let tracker;
  let request;
  let startedAt;
  let scrollDepth = 0;
  let viewed = false;

  function capture(name, properties) {
    if (consent && tracker && !privacySignal()) tracker.capture(name, properties);
  }

  function pageview() {
    if (viewed || !tracker || !consent) return;
    viewed = true;
    startedAt = performance.now();
    scrollDepth = 0;
    capture('$pageview');
  }

  async function applyConsent(granted) {
    consent = granted && !privacySignal();
    if (!consent) {
      tracker?.disable();
      viewed = false;
      try {
        sessionStorage.removeItem(attributionKey);
        sessionStorage.removeItem(`${attributionKey}-time`);
      } catch { /* Storage can be blocked in private browsing. */ }
      return;
    }
    request ??= import('./posthog-client.js');
    const { createTracker } = await request;
    if (!consent || privacySignal()) return;
    tracker ??= createTracker({
      token: marker.dataset.gmcAnalyticsToken,
      page: context,
      origin: url.origin,
      mayRecord: Boolean(context.replay && !url.search && !url.hash),
      isAllowed: () => consent && !privacySignal(),
    });
    tracker.enable(attribution(url));
    pageview();
  }

  function update(granted) {
    applyConsent(granted).catch(() => { request = undefined; });
  }

  window.addEventListener('gmc:analytics-consent', event => update(event.detail === 'granted'));
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      viewed = false;
      update(savedConsent());
    }
  });
  document.addEventListener('click', event => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const control = event.target.closest('a, button, summary, [role="tab"], [role="button"]');
    if (!control) return;
    const result = interaction(control, url, context);
    if (result) capture(...result);
  }, { capture: true });
  document.addEventListener('change', event => {
    if (event.isTrusted && context.surface === 'gallery' && event.target.matches('input[type="radio"]')) {
      capture('gallery_filter_selected', { placement: 'content' });
    }
  });
  window.addEventListener('scroll', () => {
    if (!consent || !tracker || scrollDepth === 100) return;
    const maxScroll = document.documentElement.scrollHeight - innerHeight;
    if (maxScroll < 100) return;
    const reached = Math.min(100, 25 * Math.floor((scrollY + 2) / maxScroll * 4));
    if (reached > scrollDepth) {
      scrollDepth = reached;
      capture('page_scrolled', { depth_percent: scrollDepth });
    }
  }, { passive: true });
  window.addEventListener('pagehide', () => {
    if (viewed) capture('$pageleave', { $prev_pageview_duration: (performance.now() - startedAt) / 1000 });
  });
  if (savedConsent()) update(true);
}
