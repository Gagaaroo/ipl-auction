// Bundle dist/ into one self-contained HTML fragment (CSS and JS inlined), for
// hosts that serve a single page, e.g. a claude.ai Artifact. Run after `vite build`.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const asset = (re) => {
  const m = html.match(re);
  if (!m) throw new Error(`Missing asset for ${re}`);
  return readFileSync(`dist${m[1]}`, 'utf8');
};
const css = asset(/<link rel="stylesheet"[^>]*href="([^"]+\.css)"/);
const js = asset(/<script type="module"[^>]*src="([^"]+\.js)"/);
if (js.includes('</script')) throw new Error('Bundle contains </script and cannot be inlined safely');

const fonts = html.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/)[0];
const out = `<title>The Auction Table</title>
<meta name="description" content="An IPL-style player auction you can play solo against AI teams or pass-and-play with friends.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fonts}
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;
writeFileSync('dist/auction-table.html', out);
console.log(`dist/auction-table.html  ${(out.length / 1024).toFixed(0)} kB`);
