import Head from 'next/head';
import parse, { domToReact } from 'html-react-parser';

const tagName = /^[a-zA-Z][a-zA-Z:_.\d-]*$/;
const markupOptions = {
  replace(node) {
    if (typeof node.name === 'string' && !tagName.test(node.name)) {
      return <>{domToReact(node.children, markupOptions)}</>;
    }
  },
};

function SiteMetadata({ markup }) {
  return <Head>{parse(markup, markupOptions)}</Head>;
}

export default function SitePage({ document }) {
  return (
    <>
      <SiteMetadata markup={document.head} />
      {parse(document.body, markupOptions)}
    </>
  );
}
