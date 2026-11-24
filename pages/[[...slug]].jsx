import { load } from 'cheerio';
import SitePage from '../components/SitePage';
import { prepareEditorial } from '../lib/editorial';
import { enableNativeMedia, repairEditorialMedia } from '../lib/editorial-media';
import { localizeFaq } from '../lib/faq-localization';
import { listPagePaths, loadPage } from '../lib/pages';

// The React pages render at build time. The site scripts hydrate their own controls.
export const config = { unstable_runtimeJS: false };

function slugFromPath(path) {
  return path.split('/').filter(Boolean).map(decodeURIComponent);
}

function pathFromSlug(slug = []) {
  return slug.length ? `/${slug.map(encodeURIComponent).join('/')}/` : '/';
}

export async function getStaticPaths() {
  const paths = await listPagePaths();
  return {
    paths: paths.map(path => ({ params: { slug: slugFromPath(path) } })),
    fallback: false,
  };
}

export async function getStaticProps({ params }) {
  const pathname = pathFromSlug(params?.slug);
  const page = await loadPage(pathname);
  if (!page) return { notFound: true };

  const $ = load(page.html);
  await localizeFaq($, pathname);
  if (pathname === '/tw/plastic-surgery/face-lift/facial-contouring/') {
    $('head link[hreflang]:not([hreflang="zh-TW"])').remove();
  }
  if ($('head link[rel="canonical"]').length) $('body link[rel="canonical"]').remove();
  repairEditorialMedia($);
  const recommendations = prepareEditorial($, pathname);
  enableNativeMedia($);
  const htmlAttributes = { ...$('html').attr() };
  if (pathname.startsWith('/tw/')) htmlAttributes.lang = 'zh-TW';
  return {
    props: {
      document: {
        head: $('head').html() ?? '',
        body: $('body').html() ?? '',
        recommendations,
        htmlAttributes,
        bodyAttributes: { ...$('body').attr() },
      },
    },
  };
}

export default function ContentPage({ document }) {
  return <SitePage document={document} />;
}
