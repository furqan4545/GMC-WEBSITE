import { spawn } from 'node:child_process';

export const origin = 'https://gangnammedicalconcierge.com';
export const sitemapFiles = ['sitemap_index.xml', 'post-sitemap.xml', 'page-sitemap.xml', 'category-sitemap.xml'];

export function isVerificationTitle(title = '') {
  return /^(?:one moment, please|just a moment|请稍候|請稍候)[ .…]*$/i.test(title.trim());
}

export function isVerificationPage(body) {
  const title = /<title>\s*([^<]+)<\/title>/i.exec(body.subarray(0, 2500).toString())?.[1];
  return isVerificationTitle(title);
}

export function getPublic(path, timeout = 24) {
  return new Promise((resolve, reject) => {
    const process = spawn('curl', [
      '--silent', '--show-error', '--compressed', '--location', '--max-redirs', '5',
      '--connect-timeout', '8', '--max-time', String(timeout),
      '--write-out', '\n%{http_code}\t%{url_effective}\t%{content_type}',
      new URL(path, origin).href,
    ]);
    const output = [];
    const errors = [];
    process.stdout.on('data', chunk => output.push(chunk));
    process.stderr.on('data', chunk => errors.push(chunk));
    process.on('error', reject);
    process.on('close', code => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(errors).toString().trim() || `curl exited ${code}`));
        return;
      }
      const result = Buffer.concat(output);
      const split = result.lastIndexOf(10);
      const [status, destination, type] = result.subarray(split + 1).toString().split('\t');
      resolve({ status: Number(status), destination, type, body: result.subarray(0, split) });
    });
  });
}
