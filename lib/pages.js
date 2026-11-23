import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import manifest from '../content/manifest.json';

export function listPagePaths() {
  return Object.keys(manifest.pages);
}

export async function loadPage(path) {
  if (!Object.hasOwn(manifest.pages, path)) return null;
  const filename = join(process.cwd(), 'content', 'pages', manifest.pages[path]);
  return { html: gunzipSync(await readFile(filename)).toString('utf8') };
}
