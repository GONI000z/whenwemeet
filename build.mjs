// www/ 폴더에 배포용 파일을 만든다: index.html, app.js(번들), config.js, 아이콘
import { build } from 'esbuild';
import fs from 'node:fs';

fs.rmSync('www', { recursive: true, force: true });
fs.mkdirSync('www');
fs.copyFileSync('src/index.html', 'www/index.html');
for (const f of fs.readdirSync('public')) fs.copyFileSync(`public/${f}`, `www/${f}`);
fs.writeFileSync('www/config.js', `window.APP_CONFIG = { webUrl: ${JSON.stringify(process.env.WEB_URL || '')} };\n`);
fs.writeFileSync('www/.nojekyll', '');

await build({
  entryPoints: ['src/app.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2020', 'safari15', 'chrome90'],
  outfile: 'www/app.js',
  logLevel: 'info',
});
