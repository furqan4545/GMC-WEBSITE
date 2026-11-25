# Gangnam Medical Concierge website

This Next.js project contains the redesign of gangnammedicalconcierge.com. It pre-renders each copied URL with React using the saved public content and the existing design. The original WordPress site and the CRM are separate projects.

## Run the Next.js site

```sh
npm ci
npm run dev
```

Open http://localhost:3000/. `npm run build` and `npm start` run the production build. The tracked `content/` and `public/` directories contain the normalized public source pages and assets needed to build without WordPress access.

The same design is applied to existing English, Simplified Chinese, Traditional Chinese, Indonesian, Thai and Russian pages. Public page URLs, sitemap paths, titles, descriptions, canonical links, search directives, language alternates and structured data come from the original website. The previews use the original banners at their original aspect ratios and use existing gallery and treatment photographs.

The copy retains the original canonical URLs and sends a noindex header while the original domain is live. The consultation link opens the matching language form on WordPress, which continues to handle submissions. The WordPress editor and plugin settings remain on the original host.

## Refresh from the local WordPress snapshot

```sh
npm run crawl
npm run copy -- --assets
node scripts/build-collections.mjs --assets
npm run prepare:snapshot
npm run verify:seo
```

The crawl uses public GET requests and skips already copied pages. The copy produces an intermediate `dist/` folder with the original sitemap files and paths. Running `npm run copy` without `--assets` draws from the saved local cache. The collection builder uses the private local WordPress export to validate published gallery and blog counts, then writes only public entries. `prepare:snapshot` regenerates the tracked public snapshot from `dist/`.

The WordPress export and attachment backup stay in the ignored `.migration/private/` directory. They may contain unpublished records and are excluded from the GitHub repository. Use `npm run preview` for the original read-only crawl preview at http://127.0.0.1:4177/.

## Verify the build

Start the Next.js build, then run the existing browser suite against it. The checks cover desktop and phone layouts in Chromium and WebKit. They do not submit consultation requests.

```sh
npm run verify:build-seo
GMC_CHECK_DEPLOYMENT=1 GMC_PREVIEW_URL=http://localhost:3000 npm run verify:browser
node scripts/verify-site-layout.mjs --url http://localhost:3000
node scripts/verify-site-images.mjs --url http://localhost:3000
node scripts/verify-site-interactions.mjs --url http://localhost:3000
GMC_LINK_AUDIT_BASE=http://localhost:3000 node scripts/verify-site-links.mjs --local --external
```

The layout audit renders every migrated route in Chromium and WebKit. The link audit checks compiled links, article bookmarks, redirect chains and collection assets. Its optional external pass uses public read-only requests and reports blocked or unreachable destinations. Audit reports are written to `artifacts/`.

## Website analytics

The public Vercel copy uses the **Gangnam Medical Concierge Website** project in PostHog US Cloud. Set `NEXT_PUBLIC_GMC_POSTHOG_KEY` to its write-only project token in the Vercel production environment. `NEXT_PUBLIC_GMC_ANALYTICS_HOST` defaults to `gangnam-medical-website.vercel.app`. Set it to the new public host when moving the copy to its own domain. The hostname guard keeps preview builds and unrelated domains out of production reporting.

After visitors opt in, Web Analytics reports traffic sources, device and geography, visits by language and page type, engagement, and Web Vitals. Product Analytics records named actions for navigation, treatment links, consultation buttons, outbound consultation handoffs, contact channels, FAQs, galleries, and blog interactions. The WordPress form handles everything after the consultation handoff. Page URLs in analytics use public sections, with article and treatment detail pages grouped. Attribution uses recognized sources and media without forwarding incoming URL queries, searches, or campaign text.

Replay runs on eligible public pages after opt-in. It masks text and attributes and blocks media, embedded widgets, and form surfaces inside recordings. Privacy settings are available in all six languages. The PostHog project discards raw client IP data and uses its 30-day replay retention setting.

For a local run against intercepted PostHog requests, build and start with the test token and hostname below. These scripts use fictional data and never call production ingestion.

```sh
NEXT_PUBLIC_GMC_POSTHOG_KEY=phc_syntheticAnalyticsTestingOnly NEXT_PUBLIC_GMC_ANALYTICS_HOST=127.0.0.1:4191 npm run build
npm run start -- --port 4191
node scripts/verify-analytics-consent-ui.mjs --url http://127.0.0.1:4191
node scripts/verify-analytics-browser.mjs
node scripts/verify-analytics-replay.mjs
```
