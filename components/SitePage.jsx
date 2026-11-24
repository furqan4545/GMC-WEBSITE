import Head from 'next/head';
import parse, { domToReact } from 'html-react-parser';
import ArticleRecommendations from './ArticleRecommendations';

const tagName = /^[a-zA-Z][a-zA-Z:_.\d-]*$/;
function renderMarkup(markup, recommendations = []) {
  const options = {
    replace(node) {
      const index = node.attribs?.['data-gmc-recommendations'];
      const collection = recommendations[index];
      if (collection) return <ArticleRecommendations {...collection} />;
      if (typeof node.name === 'string' && !tagName.test(node.name)) {
        return <>{domToReact(node.children, options)}</>;
      }
    },
  };
  return parse(markup, options);
}

function SiteMetadata({ markup }) {
  return <Head>{renderMarkup(markup)}</Head>;
}

export default function SitePage({ document }) {
  return (
    <>
      <SiteMetadata markup={document.head} />
      {renderMarkup(document.body, document.recommendations)}
    </>
  );
}
