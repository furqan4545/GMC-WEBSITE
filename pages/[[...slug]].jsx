import { load } from 'cheerio';
import SitePage from '../components/SitePage';
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
  const page = await loadPage(pathFromSlug(params?.slug));
  if (!page) return { notFound: true };

  const $ = load(page.html);
  return {
    props: {
      document: {
        head: $('head').html() ?? '',
        body: $('body').html() ?? '',
        htmlAttributes: { ...$('html').attr() },
        bodyAttributes: { ...$('body').attr() },
      },
    },
  };
}

export default function ContentPage({ document }) {
  return <SitePage document={document} />;
}
