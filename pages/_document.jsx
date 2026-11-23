import Document, { Head, Html, Main, NextScript } from 'next/document';
import { attributesToProps } from 'html-react-parser';

export default class SiteDocument extends Document {
  static async getInitialProps(context) {
    const renderPage = context.renderPage;
    let attributes;

    context.renderPage = () => renderPage({
      enhanceApp: App => function CaptureDocumentAttributes(appProps) {
        attributes = appProps.pageProps?.document;
        return <App {...appProps} />;
      },
    });

    const initialProps = await Document.getInitialProps(context);
    return {
      ...initialProps,
      htmlAttributes: attributesToProps(attributes?.htmlAttributes ?? { lang: 'en' }, 'html'),
      bodyAttributes: attributesToProps(attributes?.bodyAttributes ?? {}, 'body'),
    };
  }

  render() {
    return (
      <Html {...this.props.htmlAttributes}>
        <Head>
          <style>{'#__next { display: contents; }'}</style>
        </Head>
        <body {...this.props.bodyAttributes}>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
