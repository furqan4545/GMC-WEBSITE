import Document, { Head, Html, Main, NextScript } from 'next/document';
import { attributesToProps } from 'html-react-parser';
import AnalyticsConsent from '../components/AnalyticsConsent';

const publicProjectToken = process.env.NEXT_PUBLIC_GMC_POSTHOG_KEY;
const websiteHost = process.env.NEXT_PUBLIC_GMC_ANALYTICS_HOST || 'gangnam-medical-website.vercel.app';
const analyticsEnabled = /^phc_[A-Za-z0-9_-]+$/.test(publicProjectToken || '');

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
          {analyticsEnabled && <link rel="stylesheet" href="/gmc-preview/analytics-consent.css" />}
        </Head>
        <body {...this.props.bodyAttributes}>
          <Main />
          {analyticsEnabled && (
            <>
              <AnalyticsConsent locale={this.props.htmlAttributes.lang} />
              <script
                type="module"
                src="/gmc-preview/analytics/website.js"
                data-gmc-analytics-token={publicProjectToken}
                data-gmc-analytics-host={websiteHost}
              />
              <script defer src="/gmc-preview/analytics-consent.js" />
            </>
          )}
          <NextScript />
        </body>
      </Html>
    );
  }
}
