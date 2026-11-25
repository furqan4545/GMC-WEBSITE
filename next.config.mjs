import { readFileSync } from 'node:fs';

const snapshot = JSON.parse(readFileSync(new URL('./content/manifest.json', import.meta.url), 'utf8'));

/** @type {import('next').NextConfig} */
const config = {
  trailingSlash: true,
  poweredByHeader: false,
  experimental: { cpus: 4 },
  async redirects() {
    return snapshot.redirects;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Content-Security-Policy', value: "form-action 'self'; connect-src 'self' https://us.i.posthog.com https://us-assets.i.posthog.com; base-uri 'self'" },
          { key: 'Referrer-Policy', value: 'strict-origin' },
        ],
      },
      ...Object.entries(snapshot.assetContentTypes).map(([source, value]) => ({
        source,
        headers: [{ key: 'Content-Type', value }],
      })),
    ];
  },
  async rewrites() {
    return {
      beforeFiles: snapshot.gone.map(source => ({ source, destination: '/api/page-gone/' })),
    };
  },
};

export default config;
