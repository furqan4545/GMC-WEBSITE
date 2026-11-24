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
node scripts/verify-site-interactions.mjs --url http://localhost:3000
GMC_LINK_AUDIT_BASE=http://localhost:3000 node scripts/verify-site-links.mjs --local --external
```

The layout audit renders every migrated route in Chromium and WebKit. The link audit checks compiled links, article bookmarks, redirect chains and collection assets. Its optional external pass uses public read-only requests and reports blocked or unreachable destinations. Audit reports are written to `artifacts/`.
