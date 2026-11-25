import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

await build({
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: { website: 'site/analytics/index.js' },
  outdir: 'public/gmc-preview/analytics',
  format: 'esm',
  bundle: true,
  splitting: true,
  minify: true,
  target: 'es2022',
  legalComments: 'linked',
});
