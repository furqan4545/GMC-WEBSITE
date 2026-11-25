import posthog from 'posthog-js/dist/module.full.no-external';
import { clickEvents } from './context.js';

const ingestion = 'https://us.i.posthog.com';
const publicEvents = new Set(['$pageview', '$pageleave', '$web_vitals', 'page_scrolled', ...clickEvents]);
const sdkFields = [
  'token', 'distinct_id', '$device_id', '$session_id', '$window_id', '$pageview_id',
  '$lib', '$lib_version', '$insert_id', '$browser', '$browser_version', '$os', '$device_type',
  '$screen_height', '$screen_width', '$viewport_height', '$viewport_width',
];
const interactionFields = ['placement', 'destination_locale', 'contact_channel', 'article_placement', 'depth_percent', '$prev_pageview_duration'];
const snapshotFields = [
  ...sdkFields, '$snapshot_bytes', '$snapshot_data', '$snapshot_host', '$snapshot_format',
];
const blockedReplayContent = [
  'form', 'input', 'textarea', 'select', '[contenteditable]', '[data-gmc-analytics-consent]',
  'img', 'picture', 'video', 'audio', 'canvas', 'iframe', 'object', 'embed',
  '.gmc-photo-grid', '.gmc-photo-dialog', '.gmc-reviews', '.ti-widget', '.elementor-widget-google_maps',
].join(',');

function pick(source, keys) {
  return Object.fromEntries(keys.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]));
}

export function createTracker({ token, page, origin, mayRecord, isAllowed }) {
  const location = new URL(page.path, origin);
  const currentUrl = location.href;
  let initialized = false;
  let attribution = {};

  function prepareEvent(data) {
    if (!isAllowed() || !data?.properties) return null;
    const { event, timestamp, uuid, properties: incoming } = data;
    if (event === '$snapshot') {
      if (!mayRecord) return null;
      return { event, timestamp, uuid, properties: pick(incoming, snapshotFields) };
    }
    if (!publicEvents.has(event)) return null;
    const properties = {
      ...pick(incoming, [...sdkFields, ...interactionFields]),
      ...attribution,
      $process_person_profile: false,
      $current_url: currentUrl,
      $host: location.host,
      $pathname: location.pathname,
      language: page.locale,
      page_type: page.surface,
    };
    // Drop nested performance attribution because it can include element selectors or URLs.
    if (event === '$web_vitals') {
      for (const metric of ['CLS', 'FCP', 'INP', 'LCP', 'TTFB']) {
        const key = `$web_vitals_${metric}_value`;
        if (Number.isFinite(incoming[key])) properties[key] = incoming[key];
      }
    }
    return { event, timestamp, uuid, properties };
  }

  function enable(source) {
    attribution = source;
    if (!initialized) {
      initialized = true;
      posthog.init(token, {
        api_host: ingestion,
        ui_host: 'https://us.posthog.com',
        defaults: '2026-08-30',
        debug: false,
        get_current_url: () => currentUrl,
        persistence: 'localStorage',
        cross_subdomain_cookie: false,
        persistence_name: 'gmc_site_analytics',
        person_profiles: 'never',
        opt_out_persistence_by_default: true,
        respect_dnt: true,
        ip: false,
        save_campaign_params: false,
        save_referrer: false,
        mask_personal_data_properties: true,
        disable_capture_url_hashes: true,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_dead_clicks: false,
        capture_copied_text: false,
        rageclick: false,
        capture_exceptions: false,
        capture_performance: { web_vitals: true, web_vitals_attribution: false, network_timing: false },
        enable_heatmaps: false,
        enable_recording_console_log: false,
        disable_surveys: true,
        disable_product_tours: true,
        disable_conversations: true,
        disable_external_dependency_loading: true,
        advanced_disable_feature_flags: true,
        advanced_disable_feature_flags_on_first_load: true,
        disable_session_recording: !mayRecord,
        request_queue_config: { flush_interval_ms: 1000 },
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: '*',
          maskAllElementAttributes: true,
          blockSelector: blockedReplayContent,
          slimDOMOptions: 'all',
          inlineStylesheet: false,
          captureJsonLd: false,
          captureCanvas: { recordCanvas: false },
          recordHeaders: false,
          recordBody: false,
          streamNetworkBody: false,
          recordCrossOriginIframes: false,
          maskCapturedNetworkRequestFn: ({ name }) => ({ name: name ? currentUrl : '' }),
        },
        before_send: prepareEvent,
      });
    }
    if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing({ captureEventName: false });
    if (mayRecord) posthog.startSessionRecording();
  }

  return {
    enable,
    disable() {
      // The consent flag is already off, so a recorder's final flush also fails closed.
      posthog.stopSessionRecording();
      posthog.opt_out_capturing();
    },
    capture(event, properties) {
      posthog.capture(event, properties, { send_instantly: true });
    },
  };
}
